import { describe, expect, it, vi } from "vitest";
import type { Comment, Post, SocialAccount } from "@prisma/client";
import { CommentService } from "../src/services/commentService.js";
import type {
  CommentWithReplyCount,
  ICommentRepository,
  Page,
} from "../src/repositories/commentRepository.js";
import type { IPostRepository } from "../src/repositories/postRepository.js";
import type { ISocialAccountRepository } from "../src/repositories/socialAccountRepository.js";
import type { IAdapterRegistry } from "../src/adapters/adapterRegistry.js";
import type { PlatformAdapter } from "../src/adapters/platformAdapter.js";
import type { IIdempotencyKeyRepository } from "../src/repositories/idempotencyKeyRepository.js";
import {
  CommentDeletedError,
  IdempotencyKeyInProgressError,
  NotFoundError,
  PlatformCommentNotFoundError,
} from "../src/errors.js";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post_1",
    platform: "instagram",
    externalPostId: "ext_post_1",
    socialAccountId: "account_1",
    publishedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    commentsSyncedAt: null,
    commentsSyncCursor: null,
    ...overrides,
  };
}

function makeSocialAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "account_1",
    platform: "instagram",
    externalAccountId: "ext_account_1",
    displayName: "Test Account",
    accessToken: "token",
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "comment_1",
    platform: "instagram",
    externalCommentId: "ext_comment_1",
    postId: "post_1",
    parentId: null,
    authorExternalId: "author_1",
    authorName: "Someone",
    authorAvatarUrl: null,
    text: "hello",
    likeCount: 0,
    publishedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

function makeCommentRepo(overrides: Partial<ICommentRepository> = {}): ICommentRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByExternalId: vi.fn().mockResolvedValue(null),
    upsertPage: vi.fn().mockResolvedValue(undefined),
    createReply: vi.fn(),
    markDeleted: vi.fn().mockResolvedValue(undefined),
    listTopLevel: vi.fn().mockResolvedValue({ items: [], nextCursor: null } satisfies Page<CommentWithReplyCount>),
    listReplies: vi.fn().mockResolvedValue({ items: [], nextCursor: null } satisfies Page<Comment>),
    ...overrides,
  };
}

function makePostRepo(overrides: Partial<IPostRepository> = {}): IPostRepository {
  return {
    findById: vi.fn().mockResolvedValue(makePost()),
    markCommentsSynced: vi.fn().mockResolvedValue(makePost()),
    ...overrides,
  };
}

function makeSocialAccountRepo(overrides: Partial<ISocialAccountRepository> = {}): ISocialAccountRepository {
  return {
    findById: vi.fn().mockResolvedValue(makeSocialAccount()),
    ...overrides,
  };
}

function makeAdapterRegistry(adapter: Partial<PlatformAdapter>): IAdapterRegistry {
  return { get: vi.fn().mockReturnValue(adapter) };
}

function makeIdempotencyKeyRepo(
  overrides: Partial<IIdempotencyKeyRepository> = {},
): IIdempotencyKeyRepository {
  return {
    reserve: vi.fn().mockResolvedValue({ outcome: "reserved" }),
    complete: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("CommentService.listTopLevelComments", () => {
  it("throws NotFoundError when the post doesn't exist", async () => {
    const service = new CommentService(
      makeCommentRepo(),
      makePostRepo({ findById: vi.fn().mockResolvedValue(null) }),
      makeSocialAccountRepo(),
      makeAdapterRegistry({}),
      makeIdempotencyKeyRepo(),
      300,
    );

    await expect(service.listTopLevelComments("missing", { limit: 20 })).rejects.toThrow(NotFoundError);
  });

  it("syncs from the platform when the cache is stale, then reads from the repository", async () => {
    const fetchComments = vi.fn().mockResolvedValue({
      comments: [
        {
          externalId: "ext_comment_1",
          externalParentId: null,
          authorExternalId: "author_1",
          authorName: "Someone",
          authorAvatarUrl: null,
          text: "hi",
          likeCount: 0,
          publishedAt: new Date("2026-01-01"),
        },
      ],
      nextCursor: "1",
    });
    const upsertPage = vi.fn().mockResolvedValue(undefined);
    const markCommentsSynced = vi.fn().mockResolvedValue(makePost());

    const service = new CommentService(
      makeCommentRepo({ upsertPage }),
      makePostRepo({ findById: vi.fn().mockResolvedValue(makePost({ commentsSyncedAt: null })), markCommentsSynced }),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ fetchComments }),
      makeIdempotencyKeyRepo(),
      300,
    );

    await service.listTopLevelComments("post_1", { limit: 20 });

    expect(fetchComments).toHaveBeenCalledTimes(1);
    expect(upsertPage).toHaveBeenCalledWith("post_1", "instagram", expect.any(Array));
    // Short page means caught up, so the walk stops despite a non-null nextCursor.
    expect(markCommentsSynced).toHaveBeenCalledWith(expect.any(String), expect.any(Date), "1");
  });

  it("resumes syncing from the post's persisted cursor instead of restarting from the beginning", async () => {
    const fetchComments = vi.fn().mockResolvedValue({ comments: [], nextCursor: "251" });

    const service = new CommentService(
      makeCommentRepo(),
      makePostRepo({
        findById: vi.fn().mockResolvedValue(
          makePost({ commentsSyncedAt: null, commentsSyncCursor: "250" }),
        ),
      }),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ fetchComments }),
      makeIdempotencyKeyRepo(),
      300,
    );

    await service.listTopLevelComments("post_1", { limit: 20 });

    // Must resume from the persisted cursor, not restart from page 1.
    expect(fetchComments).toHaveBeenCalledWith(expect.objectContaining({ cursor: "250" }));
  });

  it("skips syncing when the cache is fresh", async () => {
    const fetchComments = vi.fn();
    const service = new CommentService(
      makeCommentRepo(),
      makePostRepo({ findById: vi.fn().mockResolvedValue(makePost({ commentsSyncedAt: new Date() })) }),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ fetchComments }),
      makeIdempotencyKeyRepo(),
      300,
    );

    await service.listTopLevelComments("post_1", { limit: 20 });

    expect(fetchComments).not.toHaveBeenCalled();
  });

  it("does not resync on subsequent pages of the same pagination walk", async () => {
    const fetchComments = vi.fn();
    const service = new CommentService(
      makeCommentRepo(),
      makePostRepo({ findById: vi.fn().mockResolvedValue(makePost({ commentsSyncedAt: null })) }),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ fetchComments }),
      makeIdempotencyKeyRepo(),
      300,
    );

    await service.listTopLevelComments("post_1", { limit: 20, cursor: "some-cursor" });

    expect(fetchComments).not.toHaveBeenCalled();
  });
});

describe("CommentService.replyToComment", () => {
  it("throws NotFoundError when the parent comment doesn't exist", async () => {
    const service = new CommentService(
      makeCommentRepo({ findById: vi.fn().mockResolvedValue(null) }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({}),
      makeIdempotencyKeyRepo(),
      300,
    );

    await expect(service.replyToComment("missing", "hi")).rejects.toThrow(NotFoundError);
  });

  it("posts through the adapter and stores the reply under the resolved parent", async () => {
    const parent = makeComment({ id: "comment_1", externalCommentId: "ext_comment_1" });
    const postReply = vi.fn().mockResolvedValue({
      externalId: "ext_reply_1",
      externalParentId: "ext_comment_1",
      authorExternalId: "me",
      authorName: "Me",
      authorAvatarUrl: null,
      text: "thanks!",
      likeCount: 0,
      publishedAt: new Date("2026-01-02"),
    });
    const createReply = vi.fn().mockResolvedValue(makeComment({ id: "comment_2", text: "thanks!" }));

    const service = new CommentService(
      makeCommentRepo({ findById: vi.fn().mockResolvedValue(parent), createReply }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ postReply }),
      makeIdempotencyKeyRepo(),
      300,
    );

    const result = await service.replyToComment("comment_1", "thanks!");

    expect(postReply).toHaveBeenCalledWith(
      expect.objectContaining({ externalParentCommentId: "ext_comment_1", text: "thanks!" }),
    );
    expect(createReply).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "comment_1", postId: "post_1", platform: "instagram" }),
    );
    expect(result.text).toBe("thanks!");
  });

  it("re-parents the reply when the adapter flattens it to a different ancestor (Instagram-style)", async () => {
    const parent = makeComment({ id: "comment_reply", externalCommentId: "ext_reply", parentId: "comment_top" });
    const topLevel = makeComment({ id: "comment_top", externalCommentId: "ext_top", parentId: null });

    const postReply = vi.fn().mockResolvedValue({
      externalId: "ext_reply_2",
      externalParentId: "ext_top", // adapter flattened to the top-level ancestor
      authorExternalId: "me",
      authorName: "Me",
      authorAvatarUrl: null,
      text: "@original thanks!",
      likeCount: 0,
      publishedAt: new Date("2026-01-02"),
    });
    const createReply = vi.fn().mockResolvedValue(makeComment({ id: "comment_3" }));

    const service = new CommentService(
      makeCommentRepo({
        findById: vi.fn().mockResolvedValue(parent),
        findByExternalId: vi.fn().mockResolvedValue(topLevel),
        createReply,
      }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ postReply }),
      makeIdempotencyKeyRepo(),
      300,
    );

    await service.replyToComment("comment_reply", "thanks!");

    expect(createReply).toHaveBeenCalledWith(expect.objectContaining({ parentId: "comment_top" }));
  });

  it("returns the original comment for a completed idempotency key without calling the platform again", async () => {
    const alreadyCreated = makeComment({ id: "comment_2", text: "thanks!" });
    const postReply = vi.fn();
    const idempotencyKeys = makeIdempotencyKeyRepo({
      reserve: vi.fn().mockResolvedValue({
        outcome: "existing",
        status: "completed",
        commentId: "comment_2",
      }),
    });

    const service = new CommentService(
      makeCommentRepo({ findById: vi.fn().mockResolvedValue(alreadyCreated) }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ postReply }),
      idempotencyKeys,
      300,
    );

    const result = await service.replyToComment("comment_1", "thanks!", "key-123");

    expect(postReply).not.toHaveBeenCalled();
    expect(result).toBe(alreadyCreated);
  });

  it("rejects with IdempotencyKeyInProgressError when a duplicate request races an in-flight one", async () => {
    const postReply = vi.fn();
    const idempotencyKeys = makeIdempotencyKeyRepo({
      reserve: vi.fn().mockResolvedValue({ outcome: "existing", status: "pending", commentId: null }),
    });

    const service = new CommentService(
      makeCommentRepo(),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ postReply }),
      idempotencyKeys,
      300,
    );

    await expect(service.replyToComment("comment_1", "thanks!", "key-123")).rejects.toThrow(
      IdempotencyKeyInProgressError,
    );
    expect(postReply).not.toHaveBeenCalled();
  });

  it("marks the idempotency key completed with the new comment's id after a successful reply", async () => {
    const parent = makeComment({ id: "comment_1", externalCommentId: "ext_comment_1" });
    const postReply = vi.fn().mockResolvedValue({
      externalId: "ext_reply_1",
      externalParentId: "ext_comment_1",
      authorExternalId: "me",
      authorName: "Me",
      authorAvatarUrl: null,
      text: "thanks!",
      likeCount: 0,
      publishedAt: new Date("2026-01-02"),
    });
    const createReply = vi.fn().mockResolvedValue(makeComment({ id: "comment_2", text: "thanks!" }));
    const complete = vi.fn().mockResolvedValue(undefined);
    const idempotencyKeys = makeIdempotencyKeyRepo({ complete });

    const service = new CommentService(
      makeCommentRepo({ findById: vi.fn().mockResolvedValue(parent), createReply }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ postReply }),
      idempotencyKeys,
      300,
    );

    await service.replyToComment("comment_1", "thanks!", "key-123");

    expect(complete).toHaveBeenCalledWith("key-123", "comment_2");
  });

  it("throws CommentDeletedError without calling the platform when the parent was already soft-deleted", async () => {
    const parent = makeComment({ id: "comment_1", deletedAt: new Date("2026-01-05") });
    const postReply = vi.fn();

    const service = new CommentService(
      makeCommentRepo({ findById: vi.fn().mockResolvedValue(parent) }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ postReply }),
      makeIdempotencyKeyRepo(),
      300,
    );

    await expect(service.replyToComment("comment_1", "thanks!")).rejects.toThrow(CommentDeletedError);
    expect(postReply).not.toHaveBeenCalled();
  });

  it("self-heals the cache and throws CommentDeletedError when the platform reports the target is gone", async () => {
    const parent = makeComment({ id: "comment_1", externalCommentId: "ext_comment_1" });
    const postReply = vi.fn().mockRejectedValue(new PlatformCommentNotFoundError("instagram", "ext_comment_1"));
    const markDeleted = vi.fn().mockResolvedValue(undefined);

    const service = new CommentService(
      makeCommentRepo({ findById: vi.fn().mockResolvedValue(parent), markDeleted }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ postReply }),
      makeIdempotencyKeyRepo(),
      300,
    );

    await expect(service.replyToComment("comment_1", "thanks!")).rejects.toThrow(CommentDeletedError);
    expect(markDeleted).toHaveBeenCalledWith("comment_1");
  });

  it("releases the idempotency key when the parent was already soft-deleted", async () => {
    const parent = makeComment({ id: "comment_1", deletedAt: new Date("2026-01-05") });
    const release = vi.fn().mockResolvedValue(undefined);
    const idempotencyKeys = makeIdempotencyKeyRepo({ release });

    const service = new CommentService(
      makeCommentRepo({ findById: vi.fn().mockResolvedValue(parent) }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({}),
      idempotencyKeys,
      300,
    );

    await expect(service.replyToComment("comment_1", "thanks!", "key-123")).rejects.toThrow(CommentDeletedError);
    expect(release).toHaveBeenCalledWith("key-123");
  });

  it("does not release the idempotency key when the platform call fails ambiguously", async () => {
    const parent = makeComment({ id: "comment_1", externalCommentId: "ext_comment_1" });
    const postReply = vi.fn().mockRejectedValue(new Error("network blip"));
    const release = vi.fn().mockResolvedValue(undefined);
    const idempotencyKeys = makeIdempotencyKeyRepo({ release });

    const service = new CommentService(
      makeCommentRepo({ findById: vi.fn().mockResolvedValue(parent) }),
      makePostRepo(),
      makeSocialAccountRepo(),
      makeAdapterRegistry({ postReply }),
      idempotencyKeys,
      300,
    );

    await expect(service.replyToComment("comment_1", "thanks!", "key-123")).rejects.toThrow("network blip");
    expect(release).not.toHaveBeenCalled();
  });
});
