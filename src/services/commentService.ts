import type { Comment } from "@prisma/client";
import type { IAdapterRegistry } from "../adapters/adapterRegistry.js";
import {
  CommentDeletedError,
  IdempotencyKeyInProgressError,
  NotFoundError,
  PlatformCommentNotFoundError,
  UnsupportedPlatformError,
} from "../errors.js";
import { isPlatform } from "../types/platform.js";
import type { NormalizedComment } from "../types/comment.js";
import type {
  CommentWithReplyCount,
  ICommentRepository,
  Page,
} from "../repositories/commentRepository.js";
import type { IIdempotencyKeyRepository } from "../repositories/idempotencyKeyRepository.js";
import type { IPostRepository } from "../repositories/postRepository.js";
import type { ISocialAccountRepository } from "../repositories/socialAccountRepository.js";

/** Caps pages pulled from a platform in one sync, so one request can't turn into an unbounded crawl. */
const MAX_SYNC_PAGES = 5;
const SYNC_PAGE_SIZE = 50;

export interface ListPageOptions {
  cursor?: string | null;
  limit: number;
  /** Bypass the freshness check and pull from the platform right now. */
  forceSync?: boolean;
}

export class CommentService {
  constructor(
    private readonly comments: ICommentRepository,
    private readonly posts: IPostRepository,
    private readonly socialAccounts: ISocialAccountRepository,
    private readonly adapters: IAdapterRegistry,
    private readonly idempotencyKeys: IIdempotencyKeyRepository,
    private readonly cacheTtlSeconds: number,
  ) {}

  async listTopLevelComments(
    postId: string,
    options: ListPageOptions,
  ): Promise<Page<CommentWithReplyCount>> {
    const post = await this.posts.findById(postId);
    if (!post) throw new NotFoundError(`Post ${postId} not found`);

    // Only resync on the first page — mid-walk resyncs are safe (upserts
    // are idempotent) but add latency for no benefit within one walk.
    const isFirstPage = !options.cursor;
    if (isFirstPage && (options.forceSync || this.isStale(post.commentsSyncedAt))) {
      await this.syncFromPlatform(
        post.id,
        post.platform,
        post.externalPostId,
        post.socialAccountId,
        post.commentsSyncCursor,
      );
    }

    return this.comments.listTopLevel(postId, options);
  }

  async listReplies(commentId: string, options: ListPageOptions): Promise<Page<Comment>> {
    const comment = await this.comments.findById(commentId);
    if (!comment) throw new NotFoundError(`Comment ${commentId} not found`);

    return this.comments.listReplies(commentId, options);
  }

  async replyToComment(commentId: string, text: string, idempotencyKey?: string | null): Promise<Comment> {
    if (idempotencyKey) {
      const reservation = await this.idempotencyKeys.reserve(idempotencyKey);
      if (reservation.outcome === "existing") {
        if (reservation.status === "pending") {
          throw new IdempotencyKeyInProgressError(idempotencyKey);
        }
        const existing = reservation.commentId
          ? await this.comments.findById(reservation.commentId)
          : null;
        if (existing) return existing;
        // Completed row lost its comment link somehow — fall through and retry as if fresh.
      }
    }

    try {
      const parent = await this.comments.findById(commentId);
      if (!parent) throw new NotFoundError(`Comment ${commentId} not found`);
      if (parent.deletedAt) throw new CommentDeletedError(parent.id);

      const post = await this.posts.findById(parent.postId);
      if (!post) throw new NotFoundError(`Post ${parent.postId} not found`);

      const socialAccount = await this.socialAccounts.findById(post.socialAccountId);
      if (!socialAccount) {
        throw new NotFoundError(`Social account ${post.socialAccountId} not found`);
      }

      if (!isPlatform(post.platform)) throw new UnsupportedPlatformError(post.platform);
      const adapter = this.adapters.get(post.platform);

      let normalized: NormalizedComment;
      try {
        normalized = await adapter.postReply({
          externalPostId: post.externalPostId,
          externalParentCommentId: parent.externalCommentId,
          account: {
            platform: post.platform,
            externalAccountId: socialAccount.externalAccountId,
            accessToken: socialAccount.accessToken,
          },
          text,
        });
      } catch (err) {
        if (err instanceof PlatformCommentNotFoundError) {
          // The platform confirms the target is gone and nothing was posted —
          // self-heal our cache immediately instead of waiting for the next sync.
          await this.comments.markDeleted(parent.id);
          throw new CommentDeletedError(parent.id);
        }
        throw err;
      }

      // Trust the adapter's reported parent over the id we requested —
      // e.g. Instagram may flatten a reply-to-a-reply onto its ancestor.
      let parentId = parent.id;
      if (normalized.externalParentId && normalized.externalParentId !== parent.externalCommentId) {
        const resolvedParent = await this.comments.findByExternalId(
          post.platform,
          normalized.externalParentId,
        );
        if (resolvedParent) parentId = resolvedParent.id;
      }

      const created = await this.comments.createReply({
        postId: post.id,
        platform: post.platform,
        parentId,
        comment: normalized,
      });

      if (idempotencyKey) {
        await this.idempotencyKeys.complete(idempotencyKey, created.id);
      }

      return created;
    } catch (err) {
      // Only release the key when we're certain the platform was never
      // actually called (or, for CommentDeletedError, that it confirmed
      // nothing was posted) — for anything else we don't know whether a
      // retry would double-post, so the key stays pending on purpose.
      const safeToRelease =
        err instanceof NotFoundError ||
        err instanceof CommentDeletedError ||
        err instanceof UnsupportedPlatformError;
      if (idempotencyKey && safeToRelease) {
        await this.idempotencyKeys.release(idempotencyKey);
      }
      throw err;
    }
  }

  private isStale(commentsSyncedAt: Date | null): boolean {
    if (!commentsSyncedAt) return true;
    const ageSeconds = (Date.now() - commentsSyncedAt.getTime()) / 1000;
    return ageSeconds > this.cacheTtlSeconds;
  }

  private async syncFromPlatform(
    postId: string,
    platformRaw: string,
    externalPostId: string,
    socialAccountId: string,
    startCursor: string | null,
  ): Promise<void> {
    if (!isPlatform(platformRaw)) throw new UnsupportedPlatformError(platformRaw);
    const adapter = this.adapters.get(platformRaw);

    const socialAccount = await this.socialAccounts.findById(socialAccountId);
    if (!socialAccount) throw new NotFoundError(`Social account ${socialAccountId} not found`);

    // Resume from the last sync's cursor — otherwise a thread bigger than
    // MAX_SYNC_PAGES would never converge on new comments.
    let cursor: string | null = startCursor;
    for (let page = 0; page < MAX_SYNC_PAGES; page++) {
      const result = await adapter.fetchComments({
        externalPostId,
        account: {
          platform: platformRaw,
          externalAccountId: socialAccount.externalAccountId,
          accessToken: socialAccount.accessToken,
        },
        cursor,
        limit: SYNC_PAGE_SIZE,
      });
      if (result.comments.length > 0) {
        await this.comments.upsertPage(postId, platformRaw, result.comments);
      }
      cursor = result.nextCursor;
      // Short page = caught up, no need to spend more budget on empty follow-ups.
      if (result.comments.length < SYNC_PAGE_SIZE) break;
    }

    await this.posts.markCommentsSynced(postId, new Date(), cursor);
  }
}
