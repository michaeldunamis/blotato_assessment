# Blotato Take-Home: Multi-Platform Comment System

A REST API for retrieving comments on a published post and replying to a comment, across multiple social platforms. Built with Fastify and Prisma/Postgres. Platform-specific logic lives behind a `PlatformAdapter` interface, so the rest of the system never branches on which platform it's talking to.

Two adapters are implemented (Twitter/X, Instagram) against simulated platform APIs. See Assumptions for why.

## Quick start

```bash
cp .env.example .env
npm install
npm run prisma:migrate
npm run db:seed
npm run dev
```

```bash
npm test                 # unit tests, no DB needed
npm run test:integration # repository tests against real Postgres
npm run lint
```

The seed script prints two post ids to hit:

```
GET /api/posts/<twitter-post-id>/comments
GET /api/posts/<instagram-post-id>/comments
```

CI (`.github/workflows/ci.yml`) runs lint, build, and unit tests on every push, plus a separate integration job against a Postgres service container.

## Architecture

```
Route (Fastify) → CommentService → ICommentRepository → Postgres (cache)
                        │
                        └→ PlatformAdapter → platform API
```

- **`PlatformAdapter`** (`src/adapters/platformAdapter.ts`) normalizes a platform's API into two methods: `fetchComments` and `postReply`. Adding a platform means implementing this interface and registering it in `AdapterRegistry`. Nothing else changes.
- **`CommentService`** orchestrates adapters and repositories: cache-aside sync on read, write-through on reply. It depends on repository interfaces, not concrete classes, which is what makes `test/commentService.test.ts` possible without a real database.
- Real platform calls are stubbed by an in-memory client per adapter (`twitterClient`, `instagramClient`), sharing a `RemoteClient` base for storage/pagination. A real adapter swaps the client for an actual SDK call; normalization, error mapping, and threading rules stay the same.

## Database schema

```
social_accounts (id, platform, external_account_id, display_name, access_token, ...)
posts           (id, platform, external_post_id, social_account_id, published_at,
                  comments_synced_at, comments_sync_cursor)
comments        (id, platform, external_comment_id, post_id, parent_id, author_*, text,
                  like_count, published_at, deleted_at)
```

Full definitions in `prisma/schema.prisma`.

- `comments.parent_id` self-references, so the schema supports arbitrarily deep threads. Whether a platform actually allows that depth is enforced by the adapter, not the schema.
- Uniqueness is `(platform, external_*_id)`, not the external id alone, since different platforms can reuse id spaces.
- `platform` is a plain string, not a DB enum. Adding a platform shouldn't require a migration, just a new adapter. The tradeoff is the database won't reject a typo'd platform value; that's enforced in the app layer instead via a `Platform` union type.

## API design

There's deliberately no `platform` field in any request. `postId` and `commentId` are our own row ids and already know their platform, so a client can't pass one that contradicts the other.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/posts/:postId/comments` | Top-level comments for a post, paginated. Syncs from the platform first if stale (or `?sync=true`). |
| `GET` | `/api/comments/:commentId/replies` | Replies to a comment, paginated. |
| `POST` | `/api/comments/:commentId/replies` | Reply to a comment. Calls the platform, then persists the result. |
| `GET` | `/health` | Liveness check. |

Pagination is cursor-based, keyset over `(publishedAt, id)`. Offset pagination breaks here because the list is appended to between page requests as syncs happen mid-walk.

Replies aren't inlined into the top-level list. Each comment carries a `replyCount`, and replies are fetched on demand, matching how most platform UIs work.

Errors: `NotFoundError → 404`, `UnsupportedPlatformError → 400`, `PlatformApiError → 502`, validation failures `→ 400`.

## Major design decisions

**Cache-aside reads, write-through replies.** Reads never hit the platform directly; they read Postgres and trigger a sync only if `comments_synced_at` is older than `COMMENT_CACHE_TTL_SECONDS`. Each sync is capped at 5 pages and resumes from a persisted cursor rather than restarting, so a large thread converges over several TTL cycles instead of endlessly re-fetching the same oldest page. Replies are write-through: posted to the platform first, only persisted locally once confirmed. See Production considerations for what this doesn't cover.

**Threading is platform-specific.** Twitter/X chains replies arbitrarily deep. Instagram's `/replies` edge only accepts top-level comment ids, so `InstagramAdapter` resolves a reply-to-a-reply up to its top-level ancestor and prepends an `@mention`, matching what Instagram's own app does. The adapter reports the actual parent back via `externalParentId`, and `CommentService` trusts that over the id it requested.

**Idempotent, two-pass sync.** Adapter pages are merged via `upsert` keyed on `(platform, externalCommentId)`, so re-syncing overlapping pages is a no-op. Parent linkage happens in a second pass, since a comment's parent isn't guaranteed to appear earlier in the same page. Covered by an integration test against real Postgres, not a mock, since this ordering logic is exactly what a mocked test can't verify.

## Production considerations (not implemented)

- **Rate limiting and retries.** Real platform APIs rate-limit you. Needs a distinct rate-limit error type, retried with backoff honoring `Retry-After`, and a `429` surfaced to our own caller instead of a generic `502`.
- **Idempotent replies.** A client retry after a timeout can double-post. Fix: an `Idempotency-Key` header, atomically claimed before the platform call. Doesn't fully close the gap where our process crashes between the platform confirming and us persisting; that needs an outbox pattern.
- **Real-time updates via webhooks.** Polling means new comments are only as fresh as the next TTL cycle. Instagram and X both support webhooks for comment events; a signed webhook route would push comments immediately instead, with polling as fallback.
- **Auth and multi-tenancy.** No concept of who's asking. A real deployment validates a token, resolves it to a tenant, and scopes every query by it.
- **Observability.** No metrics beyond default request logging. Nothing answers "is sync falling behind" without grepping logs.
- **OAuth token lifecycle.** `accessToken` is treated as static. Real tokens expire and need refresh/rotation handling.
- **Data retention / privacy.** No purge path for a platform-side deletion or an erasure request; `deletedAt` only means "no longer seen upstream."
- **Platform API versioning.** No detection for a breaking upstream API change; it'd surface as silent sync degradation.

## Assumptions

- No real platform credentials. Adapters wrap in-memory clients modeled on each platform's documented behavior; swapping in a real SDK client touches only the adapter.
- Auth/authz is out of scope; see Production considerations.
- `accessToken` is a plaintext column here. In production it'd be a secrets-manager reference.
- A thread fits in 5 sync pages (250 comments) per request; deeper threads catch up over subsequent syncs.
- Deleted-upstream comments aren't actively detected; sync only adds/updates, it doesn't diff for removals.

## AI usage disclosure

I used AI to scaffold the project: initial file/folder structure and boilerplate. The platform adapters, threading logic, and other core pieces of the implementation were written by me.
