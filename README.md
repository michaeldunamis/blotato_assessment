# Blotato Take-Home: Multi-Platform Comment System

REST API for reading comments on published posts and replying to comments across multiple social platforms. Built with Fastify, Prisma, and PostgreSQL.

Platform-specific behavior is isolated behind a `PlatformAdapter` interface, so the core application does not branch on individual platforms. Two adapters are implemented (Twitter/X and Instagram) against simulated platform APIs; no real credentials are required.

## Quick start

```bash
cp .env.example .env
npm install
npm run prisma:migrate
npm run db:seed
npm run dev
```

Run tests and checks:

```bash
npm test                 # unit tests, no database required
npm run test:integration # repository tests against PostgreSQL
npm run lint
```

The seed command prints two post IDs that can be used with:

```text
GET /api/posts/<twitter-post-id>/comments
GET /api/posts/<instagram-post-id>/comments
```

CI (`.github/workflows/ci.yml`) runs linting, build, and unit tests on every push, plus integration tests against a PostgreSQL service container.

## Architecture

```text
Route (Fastify)
      ↓
CommentService
      ↓
ICommentRepository ─────→ PostgreSQL (local read model)
      │
      └──────────────────→ PlatformAdapter → Platform API
```

`CommentService` depends on repository and platform interfaces rather than concrete implementations. This keeps business logic independent of both PostgreSQL and individual social platforms.

Unit tests in `test/commentService.test.ts` run without a database or external API. Each platform adapter currently uses an in-memory client that models the relevant platform behavior; replacing it with a real SDK is isolated to the adapter layer.

## Database schema

```text
social_accounts
  id, platform, external_account_id, display_name, access_token, ...

posts
  id, platform, external_post_id, social_account_id,
  published_at, comments_synced_at, comments_sync_cursor

comments
  id, platform, external_comment_id, post_id, parent_id,
  author_*, text, like_count, published_at, deleted_at
```

Full definitions are in `prisma/schema.prisma`.

Key decisions:

* `comments.parent_id` self-references `comments` to represent reply relationships.
* Platform-specific thread-depth rules are handled by the adapter rather than encoded in the database schema.
* External identifiers are unique within their platform: `(platform, external_*_id)`. This avoids collisions when different platforms use overlapping ID spaces.
* `platform` is stored as a string rather than a database enum, so adding a new platform does not require a schema migration. Supported platforms are constrained by the application-level `Platform` type and adapter registry.

## API design

The API does not require a `platform` field. `postId` and `commentId` are internal IDs that already identify the associated platform.

| Method | Path                               | Description                                                                                                                         |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/posts/:postId/comments`      | Retrieve top-level comments, paginated. Synchronizes from the platform when stale or when `?sync=true` is requested.                |
| `GET`  | `/api/comments/:commentId/replies` | Retrieve replies to a comment, paginated.                                                                                           |
| `POST` | `/api/comments/:commentId/replies` | Reply to a comment. Posts to the platform and persists the confirmed result locally. Supports an optional `Idempotency-Key` header. |
| `GET`  | `/health`                          | Liveness check.                                                                                                                     |

### Pagination

Comments use cursor-based keyset pagination over `(publishedAt, id)`.

Offset pagination was deliberately avoided because synchronization can insert new comments while a client is walking through a result set, which can cause records to be skipped or duplicated.

Replies are not embedded in the top-level comment response. Each comment exposes `replyCount`, while replies are retrieved independently.

### Error mapping

| Error                           | HTTP status |
| ------------------------------- | ----------: |
| `NotFoundError`                 |         404 |
| `UnsupportedPlatformError`      |         400 |
| `CommentDeletedError`           |         410 |
| `IdempotencyKeyInProgressError` |         409 |
| `PlatformApiError`              |         502 |
| Validation errors               |         400 |

## Major design decisions

### 1. Local read model with cache-aside synchronization

Reads are served from PostgreSQL. When `comments_synced_at` is older than `COMMENT_CACHE_TTL_SECONDS`, the service synchronizes comments from the platform before returning the result. `?sync=true` allows an explicit refresh.

PostgreSQL is treated as a **persisted local read model**, rather than a disposable cache. It contains internal identifiers, resolved thread relationships, deletion state, and idempotency records that cannot be reconstructed solely from platform data.

Each synchronization processes at most five platform pages per request to bound latency and external API usage. A persisted platform cursor allows larger comment threads to converge over subsequent synchronization cycles instead of repeatedly fetching the same pages.

Replies use a write-through flow: the platform is updated first, and the local record is persisted only after the platform confirms the reply.

### 2. Platform adapter abstraction

All platform-specific behavior is isolated behind `PlatformAdapter`.

The service operates on platform-agnostic concepts such as:

```ts
interface PlatformAdapter {
  fetchComments(...): Promise<...>;
  postReply(...): Promise<...>;
}
```

Adding another platform should therefore require a new adapter and registration rather than changes throughout the application.

This also provides a clean boundary for differences in platform capabilities, identifiers, pagination, errors, and threading semantics.

### 3. Platform-specific threading

Threading behavior is not assumed to be identical across platforms.

Twitter/X supports arbitrarily deep reply chains. Instagram's replies API operates on top-level comment IDs, so replying to a reply resolves to the top-level ancestor and prepends an `@mention`, matching the platform's behavior.

The adapter returns the platform's actual resulting parent through `externalParentId`, and the service uses that value when persisting the relationship.

This keeps platform-specific behavior inside the adapter instead of leaking it into the domain layer.

### 4. Idempotent synchronization

Synchronization is designed to be safe to repeat.

Comments are merged using an `upsert` keyed by `(platform, externalCommentId)`, so overlapping synchronization runs do not create duplicate records.

Parent relationships are resolved in a second pass because a parent comment is not guaranteed to appear before its child in the same platform page.

### 5. Idempotent replies

`POST /replies` accepts an optional `Idempotency-Key` to protect clients from duplicate replies when a request times out after the platform may already have accepted the operation.

The key is atomically reserved using a database unique constraint rather than a check-then-insert sequence, avoiding a race between concurrent requests.

Only two states are used:

```text
pending → completed
```

If the failure is known to have occurred before the platform operation could succeed (for example, invalid input, deleted target, or unsupported platform), the reservation is released so the client can safely retry.

For ambiguous failures — such as a platform timeout or a crash after the platform accepted the request but before the result was persisted — the reservation remains `pending`. This intentionally favors preventing duplicate side effects over assuming the operation failed.

A concurrent request using a pending key receives `409 Conflict`. Once completed, subsequent requests using the same key return the original result.

Pending reservations older than two minutes may be reclaimed by a subsequent request. This bounds the lifetime of an abandoned reservation while retaining protection against immediate duplicate retries.

A fully production-grade implementation could further close the remaining ambiguity window using an outbox/reconciliation mechanism.

### 6. Deletion handling

Deletion is handled both proactively and reactively.

If a comment was previously marked as deleted locally, replies are rejected without making an unnecessary platform request.

If the comment was deleted upstream after the last synchronization, the platform rejection is translated into local deletion state immediately. This self-heals the read model without waiting for the next synchronization cycle.

## Production considerations

The following are intentionally outside the scope of this take-home:

* **Rate limiting and retry/backoff:** Platform-specific limits would be handled with bounded retries, exponential backoff, and `Retry-After` where supported.
* **Webhooks:** Signed platform webhooks could reduce synchronization latency and keep the local read model fresher than polling alone.
* **Authentication and multi-tenancy:** Requests would be authenticated and scoped to the appropriate tenant and connected social accounts.
* **Observability:** Production deployment would add structured logging, metrics, tracing, and platform-specific error/latency monitoring.
* **OAuth lifecycle:** Access tokens would require secure storage, expiration handling, refresh, and rotation.
* **Data retention/privacy:** A production implementation would support retention policies and user/data erasure requirements.
* **Platform API versioning:** Adapter contracts would isolate upstream API changes and allow platform-specific version migrations.

## Assumptions

* No real platform credentials are required. Adapters wrap in-memory clients modeled on documented platform behavior.
* Authentication and authorization are intentionally omitted because they are not part of the requested functionality. In production, every post/comment lookup and mutation would be scoped to the authenticated tenant and connected social account.
* `accessToken` is stored directly for simplicity in this take-home. Production credentials would be stored using a secrets-management system or encrypted credential store.
* Each synchronization processes at most five pages per request to bound latency and platform API usage. Larger threads converge through subsequent synchronization cycles.
* Clients may provide an `Idempotency-Key` for reply requests. When provided, retries using the same key return the original result rather than creating another platform reply.

## AI usage disclosure

I used AI to scaffold the project, including the initial file/folder structure and boilerplate. The platform adapters, threading behavior, synchronization logic, idempotency handling, and other core implementation decisions were written by me.
