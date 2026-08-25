import type { Platform } from "../../types/platform.js";
import type {
  FetchCommentsPage,
  NormalizedComment,
} from "../../types/comment.js";
import { PlatformCommentNotFoundError, toPlatformError } from "../../errors.js";
import type {
  FetchCommentsParams,
  PlatformAdapter,
  PostReplyParams,
} from "../platformAdapter.js";
import { TargetCommentNotFoundError } from "../remoteClient.js";
import {
  instagramClient,
  type IgComment,
} from "./instagramClient.js";

function toNormalized(comment: IgComment): NormalizedComment {
  return {
    externalId: comment.id,
    externalParentId: comment.parentId,
    authorExternalId: comment.authorId,
    authorName: `@${comment.authorUsername}`,
    authorAvatarUrl: comment.authorAvatarUrl,
    text: comment.text,
    likeCount: comment.likeCount,
    publishedAt: comment.timestamp,
  };
}

/** Swap `instagramClient` for a real Graph API call here; nothing else in this adapter changes. */
export class InstagramAdapter implements PlatformAdapter {
  readonly platform: Platform = "instagram";

  async fetchComments(params: FetchCommentsParams): Promise<FetchCommentsPage> {
    const offset = params.cursor ? Number(params.cursor) : 0;
    try {
      const { items, nextOffset } = await instagramClient.fetchComments(
        params.externalPostId,
        offset,
        params.limit,
      );
      return {
        comments: items.map(toNormalized),
        nextCursor: String(nextOffset),
      };
    } catch (cause) {
      throw toPlatformError("Failed to fetch Instagram comments", this.platform, cause);
    }
  }

  /**
   * Instagram's `/replies` edge only accepts top-level comment ids, so a
   * reply-to-a-reply resolves up to its top-level ancestor with an
   * @mention prepended — matching what Instagram's own app does.
   */
  async postReply(params: PostReplyParams): Promise<NormalizedComment> {
    try {
      const target = await instagramClient.findById(
        params.externalPostId,
        params.externalParentCommentId,
      );
      if (!target) {
        throw new TargetCommentNotFoundError(params.externalParentCommentId);
      }

      const isReplyToAReply = target.parentId !== null;
      const topLevelParentId = isReplyToAReply ? target.parentId! : target.id;
      const text = isReplyToAReply
        ? `@${target.authorUsername} ${params.text}`
        : params.text;

      const created = await instagramClient.postReply(
        params.externalPostId,
        topLevelParentId,
        text,
      );
      return toNormalized(created);
    } catch (cause) {
      if (cause instanceof TargetCommentNotFoundError) {
        throw new PlatformCommentNotFoundError(this.platform, cause.externalCommentId);
      }
      throw toPlatformError("Failed to post Instagram reply", this.platform, cause);
    }
  }
}
