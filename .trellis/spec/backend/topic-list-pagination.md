# Topic List Pagination

> How the sidebar loads an assistant's topics: the assistant tree carries no
> topics; favorites load in full; non-favorites page by keyset cursor.
> Landed in `11-19-sidebar-topic-pagination`.

---

## Scenario: listing an assistant's topics for the sidebar

### 1. Scope / Trigger

Cross-layer contract change (`assistantSchema.topics` removed), two new Route
Handlers, a new composite index, and a keyset cursor whose timestamp precision
is easy to break.

### 2. Signatures

- DB: `topics_assistant_list_idx` on
  `(assistant_id, is_favorite, updated_at DESC NULLS FIRST, id DESC NULLS FIRST)`
  (`src/server/db/schema/assistant.ts`, migration `0029_zippy_bloodscream.sql`).
  It replaced `topics_assistant_id_idx`; its `assistant_id` prefix still serves
  FK cascades and `topicIdsForAssistant`.
- Service (`src/server/services/topic.service.ts`):
  - `listTopicPage(assistantId: string, cursor: [string, string] | null, actor: Actor): Promise<{ topics: Topic[]; nextCursor: [string, string] | null }>`
  - `listFavoriteTopics(assistantId: string, actor: Actor): Promise<Topic[]>`
- API:
  - `GET /api/assistants/[id]/topics?cursor=<opaque>` → `{ topics: Topic[], nextCursor: string | null }`
  - `GET /api/assistants/[id]/topics/favorites` → `{ topics: Topic[] }`
- Tree: `GET /api/assistants` → `assistantSchema` has `topicCount: number`, no
  `topics` (`count(topics.id)::int` over a LEFT JOIN + GROUP BY).
- Detail: `topicDetailSchema` / `findTopicDetailForActor` carry `assistantId`
  (the notification path needs it for topics the sidebar has not loaded).

### 3. Contracts

- Page: `is_favorite = false`, `ORDER BY updated_at DESC, id DESC`,
  `LIMIT 21`. Server constant `TOPIC_PAGE_SIZE = 20`; the 21st row only signals
  `nextCursor` and is never returned. The client never sends a limit.
- Cursor (wire): `base64url(JSON.stringify([updatedAtText, id]))` of the last
  returned row, opaque to the client. `updatedAtText` is `updated_at::text`
  selected next to the row. The comparison is
  `(updated_at, id) < (${at}::timestamptz, ${id})`.
- Favorites: every `is_favorite = true` row of the assistant, same order, no
  limit (favorites are few and must all be visible).
- Both endpoints call `requireOwnedAssistant` first.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Malformed cursor (not base64url JSON `[string, string]`) | Zod 400 at the route via `withErrorHandling` |
| Assistant missing or owned by another user | `AppError("NOT_FOUND", 404, "assistant.notFound")` |
| Unauthenticated | `requireActor` → 401 |
| Last page | `nextCursor: null` |

### 5. Good/Base/Bad Cases

- Good: 45 non-favorites → pages of 20 / 20 / 5, then `nextCursor: null`.
- Base: a topic touched between page 1 and page 2 moves above the cursor. It
  leaves the later pages and shows up on a refetched page 1. No row is
  duplicated, and no untouched row is skipped.
- Bad: an ISO-string or truncated second-precision cursor — SQLite
  `updated_at` stores integer epoch milliseconds, and rows inside the same
  millisecond tie-break deterministically by `id desc`.

### 6. Tests Required

`topic.service.integration.test.ts`:
- page sizes 20 / 20 / 5, null last cursor, exact order;
- touch between pages: no duplicates, every untouched row seen once;
- 25 rows sharing the exact same millisecond across the page-20 boundary
  ordered by `(updated_at desc, id desc)`;
- identical `updated_at` broken by `id`;
- favorites excluded from pages, favorites list complete past 20;
- foreign assistant → `NOT_FOUND` for both reads.

`assistant.service.integration.test.ts`: `topicCount` on tree / create.

### 7. Wrong vs Correct

#### Wrong

```ts
// ISO strings or sub-ms assumptions mismatch SQLite integer ms keyset compares:
nextCursor: [last.updatedAt.toISOString(), last.id]
```

#### Correct

```ts
// Epoch-ms string matches integer `updated_at` column directly; validated as safe int in route Zod:
nextCursor: last ? [String(last.updatedAt.getTime()), last.id] : null
```

---

## Index column order

SQLite composite indexes for `(updated_at DESC, id DESC)` must declare
explicit descending SQL expressions (`sql\`updated_at desc\``, `sql\`id desc\``)
in Drizzle (`topics_assistant_list_idx`), matching the query's `orderBy` so
`EXPLAIN QUERY PLAN` uses `COVERING INDEX` without a temp B-tree sort.

---

## Frontend contract notes

- Query keys (`use-assistants.ts`): `assistantKeys.topicPages(id)` (infinite)
  and `assistantKeys.favoriteTopics(id)`, both under
  `assistantKeys.topics(id)` and therefore under `assistantKeys.all`. Any
  mutation or stream event that changes topic order or titles invalidates
  `assistantKeys.all`, not `assistantKeys.tree()`. The tree no longer holds
  topics, so a tree-only invalidation refreshes nothing visible.
- No consumer may assume a topic is in the sidebar cache. The chat header
  title, the "already titled" check and the desktop notification read the
  topic detail (`topicKeys.detail`), never the sidebar lists.
- Infinite-query pitfalls: see [Hook Guidelines](../frontend/hook-guidelines.md)
  "Infinite queries".
