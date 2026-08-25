import { Prisma, type PrismaClient } from "@prisma/client";

export type IdempotencyStatus = "pending" | "completed";

export type ReserveResult =
  | { outcome: "reserved" }
  | { outcome: "existing"; status: IdempotencyStatus; commentId: string | null };

export interface IIdempotencyKeyRepository {
  /** Atomically claims a key. "existing" means someone already claimed it — read status to decide what to do. */
  reserve(key: string): Promise<ReserveResult>;
  complete(key: string, commentId: string): Promise<void>;
  /** Frees a pending reservation after a business-logic failure, so a retry with the same key can actually retry
   *  instead of getting a permanent IdempotencyKeyInProgress. Not for use after the platform call has been made —
   *  at that point we no longer know whether the platform already has the reply, so the key should stay pending. */
  release(key: string): Promise<void>;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** A pending reservation this old is presumed abandoned (crash, or a platform call that never got an
 *  answer either way) rather than genuinely in flight, and can be reclaimed by the next attempt. */
export const PENDING_RESERVATION_TTL_MS = 2 * 60 * 1000;

export class IdempotencyKeyRepository implements IIdempotencyKeyRepository {
  constructor(private readonly db: PrismaClient) {}

  async reserve(key: string): Promise<ReserveResult> {
    try {
      await this.db.idempotencyKey.create({ data: { key, status: "pending" } });
      return { outcome: "reserved" };
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;

      // Conditional delete doubles as a mutex: if two callers race this, only one
      // can actually delete the row, so at most one recurses to re-reserve.
      const cutoff = new Date(Date.now() - PENDING_RESERVATION_TTL_MS);
      const reclaimed = await this.db.idempotencyKey.deleteMany({
        where: { key, status: "pending", createdAt: { lt: cutoff } },
      });
      if (reclaimed.count > 0) {
        return this.reserve(key);
      }

      const existing = await this.db.idempotencyKey.findUniqueOrThrow({ where: { key } });
      return {
        outcome: "existing",
        status: existing.status as IdempotencyStatus,
        commentId: existing.commentId,
      };
    }
  }

  async complete(key: string, commentId: string): Promise<void> {
    await this.db.idempotencyKey.update({
      where: { key },
      data: { status: "completed", commentId },
    });
  }

  async release(key: string): Promise<void> {
    await this.db.idempotencyKey.deleteMany({ where: { key, status: "pending" } });
  }
}
