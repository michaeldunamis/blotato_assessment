import { describe, expect, it } from "vitest";
import { TwitterAdapter } from "../src/adapters/twitter/twitterAdapter.js";
import { PlatformApiError } from "../src/errors.js";

const account = { platform: "twitter" as const, externalAccountId: "acct_1", accessToken: "token" };

describe("TwitterAdapter", () => {
  const adapter = new TwitterAdapter();

  it("normalizes the seeded top-level comments for a fresh post", async () => {
    const page = await adapter.fetchComments({
      externalPostId: "post_fetch_1",
      account,
      cursor: null,
      limit: 50,
    });

    expect(page.comments).toHaveLength(2);
    expect(page.comments[0]).toMatchObject({ externalParentId: null, authorName: "@amir_builds" });
    expect(page.nextCursor).toBe("2");
  });

  it("chains a reply to another reply without flattening (X supports real threads)", async () => {
    const postId = "post_chain_1";
    const page = await adapter.fetchComments({ externalPostId: postId, account, cursor: null, limit: 50 });
    const firstComment = page.comments[0]!;

    const reply1 = await adapter.postReply({
      externalPostId: postId,
      externalParentCommentId: firstComment.externalId,
      account,
      text: "first reply",
    });
    expect(reply1.externalParentId).toBe(firstComment.externalId);

    const reply2 = await adapter.postReply({
      externalPostId: postId,
      externalParentCommentId: reply1.externalId,
      account,
      text: "reply to the reply",
    });

    // Unlike Instagram, this stays chained — no flattening to the top-level comment.
    expect(reply2.externalParentId).toBe(reply1.externalId);
  });

  it("wraps an unknown parent comment id in a PlatformApiError", async () => {
    await expect(
      adapter.postReply({
        externalPostId: "post_missing_1",
        externalParentCommentId: "does_not_exist",
        account,
        text: "hi",
      }),
    ).rejects.toThrow(PlatformApiError);
  });
});
