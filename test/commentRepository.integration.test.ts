import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { CommentRepository } from "../src/repositories/commentRepository.js";
import type { NormalizedComment } from "../src/types/comment.js";

/**
 * Exercises the two-pass parent-linking logic in upsertPage against a real
 * Postgres — the thing a mocked repository test can't actually verify.
 * Requires DATABASE_URL to point at a throwaway database with migrations
 * applied (see README's Testing section): `npm run test:integration`.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must point at a real Postgres database to run integration tests — see README.",
  );
}

const prisma = new PrismaClient();
const commentRepo = new CommentRepository(prisma);

async function seedPost() {
  const suffix = `${Date.now()}_${Math.random()}`;
  const account = await prisma.socialAccount.create({
    data: {
      platform: "instagram",
      externalAccountId: `acct_${suffix}`,
      displayName: "Test Account",
      accessToken: "token",
    },
  });
  return prisma.post.create({
    data: {
      platform: "instagram",
      externalPostId: `post_${suffix}`,
      socialAccountId: account.id,
      publishedAt: new Date(),
    },
  });
}

function makeComment(overrides: Partial<NormalizedComment> = {}): NormalizedComment {
  return {
    externalId: `ext_${Math.random()}`,
    externalParentId: null,
    authorExternalId: "author_1",
    authorName: "Someone",
    authorAvatarUrl: null,
    text: "hello",
    likeCount: 0,
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.socialAccount.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("CommentRepository.upsertPage (integration)", () => {
  it("links a reply to its parent even when the parent appears later in the same page", async () => {
    const post = await seedPost();
    const page: NormalizedComment[] = [
      makeComment({ externalId: "child_1", externalParentId: "parent_1" }),
      makeComment({ externalId: "parent_1", externalParentId: null }),
    ];

    await commentRepo.upsertPage(post.id, post.platform, page);

    const child = await commentRepo.findByExternalId(post.platform, "child_1");
    const parent = await commentRepo.findByExternalId(post.platform, "parent_1");
    expect(child?.parentId).toBe(parent?.id);
  });

  it("links a reply to a parent that was synced in an earlier call", async () => {
    const post = await seedPost();
    await commentRepo.upsertPage(post.id, post.platform, [
      makeComment({ externalId: "parent_2", externalParentId: null }),
    ]);
    await commentRepo.upsertPage(post.id, post.platform, [
      makeComment({ externalId: "child_2", externalParentId: "parent_2" }),
    ]);

    const child = await commentRepo.findByExternalId(post.platform, "child_2");
    const parent = await commentRepo.findByExternalId(post.platform, "parent_2");
    expect(child?.parentId).toBe(parent?.id);
  });

  it("leaves a comment top-level when its parent hasn't been synced yet", async () => {
    const post = await seedPost();
    await commentRepo.upsertPage(post.id, post.platform, [
      makeComment({ externalId: "orphan_1", externalParentId: "never_synced" }),
    ]);

    const orphan = await commentRepo.findByExternalId(post.platform, "orphan_1");
    expect(orphan?.parentId).toBeNull();
  });

  it("is idempotent — re-syncing the same comment updates fields instead of duplicating rows", async () => {
    const post = await seedPost();
    const comment = makeComment({ externalId: "dup_1", likeCount: 3, text: "original" });

    await commentRepo.upsertPage(post.id, post.platform, [comment]);
    await commentRepo.upsertPage(post.id, post.platform, [{ ...comment, likeCount: 9, text: "edited" }]);

    const page = await commentRepo.listTopLevel(post.id, { limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ likeCount: 9, text: "edited" });
  });

  it("keeps replies out of listTopLevel but reflects them in the parent's replyCount", async () => {
    const post = await seedPost();
    await commentRepo.upsertPage(post.id, post.platform, [
      makeComment({ externalId: "top_1", externalParentId: null }),
      makeComment({ externalId: "reply_1", externalParentId: "top_1" }),
    ]);

    const page = await commentRepo.listTopLevel(post.id, { limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ externalCommentId: "top_1", replyCount: 1 });

    const replies = await commentRepo.listReplies(page.items[0]!.id, { limit: 10 });
    expect(replies.items).toHaveLength(1);
    expect(replies.items[0]).toMatchObject({ externalCommentId: "reply_1" });
  });
});
