import { RemoteClient, TargetCommentNotFoundError } from "../remoteClient.js";

/**
 * In-memory stand-in for the Instagram Graph API so the take-home runs
 * without credentials. TODO: replace with real API calls.
 * Mirrors the real constraint: `/replies` only accepts top-level comment
 * ids — replying to a reply throws here just like the real API.
 */

interface IgComment {
  id: string;
  parentId: string | null;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string;
  text: string;
  likeCount: number;
  timestamp: Date;
}

class InstagramClient extends RemoteClient<IgComment> {
  protected seed(_postId: string): IgComment[] {
    const now = Date.now();
    const topLevelId = this.generateId("ig");
    return [
      {
        id: topLevelId,
        parentId: null,
        authorId: "ig_u_jordan",
        authorUsername: "jordan.makes",
        authorAvatarUrl: "https://i.pravatar.cc/64?u=jordan.makes",
        text: "Love the color grading on this one 😍",
        likeCount: 41,
        timestamp: new Date(now - 1000 * 60 * 60 * 8),
      },
      {
        id: this.generateId("ig"),
        parentId: topLevelId,
        authorId: "ig_u_sam",
        authorUsername: "sam.edits",
        authorAvatarUrl: "https://i.pravatar.cc/64?u=sam.edits",
        text: "@jordan.makes right?? the LUT is insane",
        likeCount: 6,
        timestamp: new Date(now - 1000 * 60 * 60 * 7),
      },
    ];
  }

  protected sortKey(comment: IgComment): number {
    return comment.timestamp.getTime();
  }

  async fetchComments(
    postId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: IgComment[]; nextOffset: number }> {
    return this.fetchPage(postId, offset, limit);
  }

  async postReply(postId: string, parentCommentId: string, text: string): Promise<IgComment> {
    await this.delay();
    const comments = this.getOrSeed(postId);
    const parent = comments.find((c) => c.id === parentCommentId);
    if (!parent) {
      throw new TargetCommentNotFoundError(parentCommentId);
    }
    if (parent.parentId !== null) {
      throw new Error(
        `Comment ${parentCommentId} is itself a reply; the /replies edge only accepts top-level comment ids`,
      );
    }
    const reply: IgComment = {
      id: this.generateId("ig"),
      parentId: parentCommentId,
      authorId: "ig_u_self",
      authorUsername: "blotato.account",
      authorAvatarUrl: "https://i.pravatar.cc/64?u=blotato.account",
      text,
      likeCount: 0,
      timestamp: new Date(),
    };
    return this.pushComment(postId, reply);
  }
}

export const instagramClient = new InstagramClient(5000);

export type { IgComment };
