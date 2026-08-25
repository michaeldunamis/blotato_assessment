import type { Platform } from "../types/platform.js";
import type {
  FetchCommentsPage,
  NormalizedComment,
  SocialAccountCredentials,
} from "../types/comment.js";

export interface FetchCommentsParams {
  externalPostId: string;
  account: SocialAccountCredentials;
  cursor: string | null;
  limit: number;
}

export interface PostReplyParams {
  externalPostId: string;
  /** The externalId of the comment being replied to. */
  externalParentCommentId: string;
  account: SocialAccountCredentials;
  text: string;
}

/**
 * Seam between our normalized comment model and a platform's API — the
 * service/route/DB layers never know which platform they're talking to.
 * Platforms disagree on reply threading depth; an adapter enforces its
 * platform's rule and reports the *effective* parent back via
 * `externalParentId`, which the service layer trusts as-is.
 */
export interface PlatformAdapter {
  readonly platform: Platform;

  fetchComments(params: FetchCommentsParams): Promise<FetchCommentsPage>;

  postReply(params: PostReplyParams): Promise<NormalizedComment>;
}
