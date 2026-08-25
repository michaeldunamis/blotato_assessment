import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  IdempotencyKeyRepository,
  PENDING_RESERVATION_TTL_MS,
} from "../src/repositories/idempotencyKeyRepository.js";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must point at a real Postgres database to run integration tests — see README.",
  );
}

const prisma = new PrismaClient();
const repo = new IdempotencyKeyRepository(prisma);

/** commentId is a real FK — reserve a real comment row so complete() satisfies the constraint. */
async function seedComment(): Promise<string> {
  const suffix = `${Date.now()}_${Math.random()}`;
  const account = await prisma.socialAccount.create({
    data: {
      platform: "instagram",
      externalAccountId: `acct_${suffix}`,
      displayName: "Test Account",
      accessToken: "token",
    },
  });
  const post = await prisma.post.create({
    data: {
      platform: "instagram",
      externalPostId: `post_${suffix}`,
      socialAccountId: account.id,
      publishedAt: new Date(),
    },
  });
  const comment = await prisma.comment.create({
    data: {
      platform: "instagram",
      externalCommentId: `ext_${suffix}`,
      postId: post.id,
      authorExternalId: "author_1",
      authorName: "Someone",
      text: "hello",
      publishedAt: new Date(),
    },
  });
  return comment.id;
}

beforeEach(async () => {
  await prisma.idempotencyKey.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.socialAccount.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("IdempotencyKeyRepository (integration)", () => {
  it("reserves a brand-new key", async () => {
    await expect(repo.reserve("key-1")).resolves.toEqual({ outcome: "reserved" });
  });

  it("returns the existing pending row on a duplicate reserve before completion", async () => {
    await repo.reserve("key-2");

    await expect(repo.reserve("key-2")).resolves.toEqual({
      outcome: "existing",
      status: "pending",
      commentId: null,
    });
  });

  it("returns the completed row with its comment id after complete()", async () => {
    const commentId = await seedComment();
    await repo.reserve("key-3");
    await repo.complete("key-3", commentId);

    await expect(repo.reserve("key-3")).resolves.toEqual({
      outcome: "existing",
      status: "completed",
      commentId,
    });
  });

  it("lets exactly one of two concurrent reserves for the same key win", async () => {
    const [a, b] = await Promise.all([repo.reserve("key-4"), repo.reserve("key-4")]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["existing", "reserved"]);
  });

  it("reclaims a pending reservation once it's past its TTL, letting a fresh attempt through", async () => {
    await repo.reserve("key-5");
    await prisma.idempotencyKey.update({
      where: { key: "key-5" },
      data: { createdAt: new Date(Date.now() - PENDING_RESERVATION_TTL_MS - 1000) },
    });

    await expect(repo.reserve("key-5")).resolves.toEqual({ outcome: "reserved" });
  });

  it("does not reclaim a pending reservation still within its TTL", async () => {
    await repo.reserve("key-6");
    await prisma.idempotencyKey.update({
      where: { key: "key-6" },
      data: { createdAt: new Date(Date.now() - PENDING_RESERVATION_TTL_MS + 5000) },
    });

    await expect(repo.reserve("key-6")).resolves.toEqual({
      outcome: "existing",
      status: "pending",
      commentId: null,
    });
  });
});
