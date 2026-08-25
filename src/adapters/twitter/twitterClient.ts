import { RemoteClient, TargetCommentNotFoundError } from "../remoteClient.js";

/**
 * In-memory stand-in for the Twitter/X API v2 client so the take-home
 * runs without credentials. TODO: replace with real API calls.
 * X supports genuine chained reply threads (a reply's parent can be
 * another reply), so unlike Instagram, no flattening is needed here.
 */

interface TweetComment {
  id: string;
  inReplyToId: string | null;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string;
  text: string;
  likeCount: number;
  createdAt: Date;
}

class TwitterClient extends RemoteClient<TweetComment> {
  protected seed(_postId: string): TweetComment[] {
    const now = Date.now();
    return [
      {
        id: this.generateId("tw"),
        inReplyToId: null,
        authorId: "u_amir",
        authorUsername: "amir_builds",
        authorAvatarUrl: "https://i.pravatar.cc/64?u=amir_builds",
        text: "This is such a clean workflow, congrats on shipping!",
        likeCount: 12,
        createdAt: new Date(now - 1000 * 60 * 60 * 5),
      },
      {
        id: this.generateId("tw"),
        inReplyToId: null,
        authorId: "u_priya",
        authorUsername: "priya_codes",
        authorAvatarUrl: "https://i.pravatar.cc/64?u=priya_codes",
        text: "Does this support scheduling across time zones?",
        likeCount: 3,
        createdAt: new Date(now - 1000 * 60 * 60 * 3),
      },
    ];
  }

  protected sortKey(comment: TweetComment): number {
    return comment.createdAt.getTime();
  }

  async fetchComments(
    postId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: TweetComment[]; nextOffset: number }> {
    return this.fetchPage(postId, offset, limit);
  }

  async postReply(postId: string, inReplyToId: string, text: string): Promise<TweetComment> {
    await this.delay();
    const comments = this.getOrSeed(postId);
    const parentExists = comments.some((c) => c.id === inReplyToId);
    if (!parentExists) {
      throw new TargetCommentNotFoundError(inReplyToId);
    }
    const reply: TweetComment = {
      id: this.generateId("tw"),
      inReplyToId,
      authorId: "u_self",
      authorUsername: "blotato_account",
      authorAvatarUrl: "https://i.pravatar.cc/64?u=blotato_account",
      text,
      likeCount: 0,
      createdAt: new Date(),
    };
    return this.pushComment(postId, reply);
  }
}

export const twitterClient = new TwitterClient(1000);

export type { TweetComment };
