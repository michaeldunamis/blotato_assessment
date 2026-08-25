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
