import type { Post, PrismaClient } from "@prisma/client";

export interface IPostRepository {
  findById(id: string): Promise<Post | null>;
  markCommentsSynced(postId: string, syncedAt: Date, cursor: string | null): Promise<Post>;
}

export class PostRepository implements IPostRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<Post | null> {
    return this.db.post.findUnique({ where: { id } });
  }

  markCommentsSynced(postId: string, syncedAt: Date, cursor: string | null): Promise<Post> {
    return this.db.post.update({
      where: { id: postId },
      data: { commentsSyncedAt: syncedAt, commentsSyncCursor: cursor },
    });
  }
}
