import type { Comment, PrismaClient } from "@prisma/client";
import type { NormalizedComment } from "../types/comment.js";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListOptions {
  cursor?: string | null;
  limit: number;
}

export type CommentWithReplyCount = Comment & { replyCount: number };

/** Port CommentService depends on — keeps the service testable without a real database. */
export interface ICommentRepository {
  findById(id: string): Promise<Comment | null>;
  findByExternalId(platform: string, externalCommentId: string): Promise<Comment | null>;
  upsertPage(postId: string, platform: string, comments: NormalizedComment[]): Promise<void>;
  createReply(params: {
    postId: string;
    platform: string;
    parentId: string;
    comment: NormalizedComment;
  }): Promise<Comment>;
  /** Marks a comment deleted immediately, e.g. when the platform rejects a reply because it's gone — without waiting for the next sync to discover it. */
  markDeleted(id: string): Promise<void>;
  listTopLevel(postId: string, options: ListOptions): Promise<Page<CommentWithReplyCount>>;
  listReplies(parentId: string, options: ListOptions): Promise<Page<Comment>>;
}

export class CommentRepository implements ICommentRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<Comment | null> {
    return this.db.comment.findUnique({ where: { id } });
  }

  findByExternalId(platform: string, externalCommentId: string): Promise<Comment | null> {
    return this.db.comment.findUnique({
      where: { platform_externalCommentId: { platform, externalCommentId } },
    });
  }

  /**
   * Idempotent upsert keyed on (platform, externalCommentId) — safe to
   * re-sync overlapping pages. Parent linkage is a second pass since a
   * comment's parent isn't guaranteed to appear earlier in the page.
   */
  async upsertPage(
    postId: string,
    platform: string,
    comments: NormalizedComment[],
  ): Promise<void> {
    if (comments.length === 0) return;

    await this.db.$transaction(async (tx) => {
      const externalToLocalId = new Map<string, string>();

      for (const comment of comments) {
        const row = await tx.comment.upsert({
          where: {
            platform_externalCommentId: { platform, externalCommentId: comment.externalId },
          },
          create: {
            platform,
            externalCommentId: comment.externalId,
            postId,
            authorExternalId: comment.authorExternalId,
            authorName: comment.authorName,
            authorAvatarUrl: comment.authorAvatarUrl,
            text: comment.text,
            likeCount: comment.likeCount,
            publishedAt: comment.publishedAt,
          },
          update: {
            authorName: comment.authorName,
            authorAvatarUrl: comment.authorAvatarUrl,
            text: comment.text,
            likeCount: comment.likeCount,
          },
        });
        externalToLocalId.set(comment.externalId, row.id);
      }

      for (const comment of comments) {
        if (!comment.externalParentId) continue;

        let parentLocalId = externalToLocalId.get(comment.externalParentId);
        if (!parentLocalId) {
          const parent = await tx.comment.findUnique({
            where: {
              platform_externalCommentId: {
                platform,
                externalCommentId: comment.externalParentId,
              },
            },
            select: { id: true },
          });
          parentLocalId = parent?.id;
        }
        if (!parentLocalId) continue; // parent not synced (yet) — left top-level for now

        await tx.comment.update({
          where: { platform_externalCommentId: { platform, externalCommentId: comment.externalId } },
          data: { parentId: parentLocalId },
        });
      }
    });
  }

  /** Inserts a reply from a live postReply call. */
  async createReply(params: {
    postId: string;
    platform: string;
    parentId: string;
    comment: NormalizedComment;
  }): Promise<Comment> {
    return this.db.comment.create({
      data: {
        platform: params.platform,
        externalCommentId: params.comment.externalId,
        postId: params.postId,
        parentId: params.parentId,
        authorExternalId: params.comment.authorExternalId,
        authorName: params.comment.authorName,
        authorAvatarUrl: params.comment.authorAvatarUrl,
        text: params.comment.text,
        likeCount: params.comment.likeCount,
        publishedAt: params.comment.publishedAt,
      },
    });
  }

  async markDeleted(id: string): Promise<void> {
    await this.db.comment.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async listTopLevel(postId: string, options: ListOptions): Promise<Page<CommentWithReplyCount>> {
    const rows = await this.db.comment.findMany({
      where: {
        postId,
        parentId: null,
        deletedAt: null,
        ...cursorWhere(options.cursor),
      },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      take: options.limit + 1,
      include: { _count: { select: { replies: { where: { deletedAt: null } } } } },
    });

    return toPage(rows, options.limit, (row) => ({ ...row, replyCount: row._count.replies }));
  }

  async listReplies(parentId: string, options: ListOptions): Promise<Page<Comment>> {
    const rows = await this.db.comment.findMany({
      where: {
        parentId,
        deletedAt: null,
        ...cursorWhere(options.cursor),
      },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      take: options.limit + 1,
    });

    return toPage(rows, options.limit, (row) => row);
  }
}

function cursorWhere(cursor?: string | null) {
  if (!cursor) return {};
  const { publishedAt, id } = decodeCursor(cursor);
  return {
    OR: [
      { publishedAt: { gt: publishedAt } },
      { publishedAt, id: { gt: id } },
    ],
  };
}

function toPage<Row extends { id: string; publishedAt: Date }, T>(
  rows: Row[],
  limit: number,
  map: (row: Row) => T,
): Page<T> {
  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  const nextCursor = hasNextPage && last ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null;
  return { items: pageRows.map(map), nextCursor };
}
