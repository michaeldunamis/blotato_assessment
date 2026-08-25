export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`No adapter registered for platform "${platform}"`);
    this.name = "UnsupportedPlatformError";
  }
}

/** A platform API call failed. Wraps the adapter-specific cause. */
export class PlatformApiError extends Error {
  constructor(
    message: string,
    public readonly platform: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}

/** A request is already in flight for this Idempotency-Key — the retry that raced it should back off, not double-post. */
export class IdempotencyKeyInProgressError extends Error {
  constructor(key: string) {
    super(`A request with Idempotency-Key "${key}" is already being processed`);
    this.name = "IdempotencyKeyInProgressError";
  }
}

/** The comment a caller is trying to reply to has been soft-deleted (no longer seen upstream). */
export class CommentDeletedError extends Error {
  constructor(commentId: string) {
    super(`Comment ${commentId} has been deleted and no longer accepts replies`);
    this.name = "CommentDeletedError";
  }
}

/**
 * The platform itself says this comment id doesn't exist — e.g. it was
 * deleted after our last sync, so our own `deletedAt` flag hasn't caught
 * up yet. Distinct from a generic PlatformApiError so CommentService can
 * react to it specifically (map to CommentDeletedError) instead of a
 * generic 502.
 */
export class PlatformCommentNotFoundError extends Error {
  constructor(
    public readonly platform: string,
    public readonly externalCommentId: string,
  ) {
    super(`Comment ${externalCommentId} not found on ${platform}`);
    this.name = "PlatformCommentNotFoundError";
  }
}

/** Adapters call this in their catch blocks: passes specific, actionable errors through as-is, wraps everything else as a generic PlatformApiError. */
export function toPlatformError(message: string, platform: string, cause: unknown): Error {
  if (cause instanceof PlatformCommentNotFoundError) return cause;
  return new PlatformApiError(message, platform, cause);
}
