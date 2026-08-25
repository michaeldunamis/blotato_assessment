import type { Platform } from "./platform.js";

/** Shape every PlatformAdapter normalizes platform-native comment data into. */
export interface NormalizedComment {
  externalId: string;
  /** Null for a top-level comment on the post. */
  externalParentId: string | null;
  authorExternalId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  likeCount: number;
  publishedAt: Date;
}

export interface FetchCommentsPage {
  comments: NormalizedComment[];
  /** Cursor for the next fetchComments call. Always present, even when `comments` is empty. */
  nextCursor: string;
}

/** Minimal credentials an adapter needs to call out to a platform. */
export interface SocialAccountCredentials {
  platform: Platform;
  externalAccountId: string;
  accessToken: string;
}
