import type { Platform } from "../../types/platform.js";
import type {
  FetchCommentsPage,
  NormalizedComment,
} from "../../types/comment.js";
import { PlatformApiError } from "../../errors.js";
import type {
  FetchCommentsParams,
  PlatformAdapter,
  PostReplyParams,
} from "../platformAdapter.js";
import { twitterClient, type TweetComment } from "./twitterClient.js";

function toNormalized(comment: TweetComment): NormalizedComment {
  return {
    externalId: comment.id,
    externalParentId: comment.inReplyToId,
    authorExternalId: comment.authorId,
    authorName: `@${comment.authorUsername}`,
    authorAvatarUrl: comment.authorAvatarUrl,
    text: comment.text,
    likeCount: comment.likeCount,
    publishedAt: comment.createdAt,
  };
}

/** Swap `twitterClient` for a real Twitter/X API v2 call here; nothing else in this adapter changes. */
export class TwitterAdapter implements PlatformAdapter {
  readonly platform: Platform = "twitter";

  async fetchComments(params: FetchCommentsParams): Promise<FetchCommentsPage> {
    const offset = params.cursor ? Number(params.cursor) : 0;
    try {
      const { items, nextOffset } = await twitterClient.fetchComments(
        params.externalPostId,
        offset,
        params.limit,
      );
      return {
        comments: items.map(toNormalized),
        nextCursor: String(nextOffset),
      };
    } catch (cause) {
      throw new PlatformApiError("Failed to fetch tweet replies", this.platform, cause);
    }
  }

  async postReply(params: PostReplyParams): Promise<NormalizedComment> {
    try {
      const created = await twitterClient.postReply(
        params.externalPostId,
        params.externalParentCommentId,
        params.text,
      );
      return toNormalized(created);
    } catch (cause) {
      throw new PlatformApiError("Failed to post tweet reply", this.platform, cause);
    }
  }
}
