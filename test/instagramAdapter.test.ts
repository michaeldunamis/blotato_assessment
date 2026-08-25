import { describe, expect, it } from "vitest";
import { InstagramAdapter } from "../src/adapters/instagram/instagramAdapter.js";
import { PlatformCommentNotFoundError } from "../src/errors.js";

const account = { platform: "instagram" as const, externalAccountId: "acct_1", accessToken: "token" };

describe("InstagramAdapter", () => {
  const adapter = new InstagramAdapter();

  it("normalizes the seeded top-level comment and its reply for a fresh post", async () => {
    const page = await adapter.fetchComments({
      externalPostId: "post_fetch_1",
      account,
      cursor: null,
      limit: 50,
    });

    expect(page.comments).toHaveLength(2);
    const topLevel = page.comments[0]!;
    const reply = page.comments[1]!;
    expect(topLevel.externalParentId).toBeNull();
    expect(reply.externalParentId).toBe(topLevel.externalId);
  });

  it("replies to a top-level comment directly, with no mention prepended", async () => {
    const postId = "post_top_level_reply_1";
    const page = await adapter.fetchComments({ externalPostId: postId, account, cursor: null, limit: 50 });
    const topLevel = page.comments[0]!;

    const reply = await adapter.postReply({
      externalPostId: postId,
      externalParentCommentId: topLevel.externalId,
      account,
      text: "nice shot!",
    });

    expect(reply.externalParentId).toBe(topLevel.externalId);
    expect(reply.text).toBe("nice shot!");
  });

  it("flattens a reply-to-a-reply onto the top-level ancestor with an @mention", async () => {
    const postId = "post_flatten_1";
    const page = await adapter.fetchComments({ externalPostId: postId, account, cursor: null, limit: 50 });
    const topLevel = page.comments[0]!;
    const existingReply = page.comments[1]!;

    const reply = await adapter.postReply({
      externalPostId: postId,
      externalParentCommentId: existingReply.externalId,
      account,
      text: "totally agree",
    });

    expect(reply.externalParentId).toBe(topLevel.externalId);
    expect(reply.text).toBe(`${existingReply.authorName} totally agree`);
  });

  it("throws PlatformCommentNotFoundError for an unknown parent comment id", async () => {
    await expect(
      adapter.postReply({
        externalPostId: "post_missing_1",
        externalParentCommentId: "does_not_exist",
        account,
        text: "hi",
      }),
    ).rejects.toThrow(PlatformCommentNotFoundError);
  });
});
