import { Prisma, type PrismaClient } from "@prisma/client";

export type IdempotencyStatus = "pending" | "completed";

export type ReserveResult =
  | { outcome: "reserved" }
  | { outcome: "existing"; status: IdempotencyStatus; commentId: string | null };

export interface IIdempotencyKeyRepository {
  /** Atomically claims a key. "existing" means someone already claimed it — read status to decide what to do. */
  reserve(key: string): Promise<ReserveResult>;
  complete(key: string, commentId: string): Promise<void>;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export class IdempotencyKeyRepository implements IIdempotencyKeyRepository {
  constructor(private readonly db: PrismaClient) {}

  async reserve(key: string): Promise<ReserveResult> {
    try {
      await this.db.idempotencyKey.create({ data: { key, status: "pending" } });
      return { outcome: "reserved" };
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
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
}
