# Topic Favorites

> Per-topic favorite flag, its API, and the `topics.updatedAt` semantics it
> codifies. Landed in `09-09-topic-favorites`.

---

## Scenario: toggling a topic's favorite state

### 1. Scope / Trigger

Database schema change (`topics.is_favorite`), new Route Handler, and a
cross-layer contract (`topicSchema` gains a required field). The non-obvious
part is **when `topics.updatedAt` may be written** — captured here so future
topic-scoped mutations do not reshuffle the sidebar.

### 2. Signatures

- DB: `topics.isFavorite` → `boolean("is_favorite").notNull().default(false)`
  (`src/server/db/schema/assistant.ts`). Migration
  `0012_bouncy_genesis.sql`, drizzle-kit generated.
- Service: `setTopicFavorite(id: string, input: SetTopicFavoriteInput, actor: Actor): Promise<Topic>`
  (`src/server/services/topic.service.ts`).
- API: `PATCH /api/topics/[id]/favorite` — body `{ favorite: boolean }`,
  returns the updated `Topic` JSON.

### 3. Contracts

- `topicSchema` (Zod, `src/lib/schemas/topic.ts`) now includes
  `isFavorite: z.boolean()`; every `Topic`-returning clause in the service
  layer must project it (six sites at time of writing: `createTopicForChat`,
  `renameTopic`, `findTopicForActor`, `setTopicFavorite`, `selectTree`,
  `title.service.ts`). A new Topic projection without the field breaks
  `topicSchema.parse` on the client.
- `setTopicFavoriteSchema = z.object({ favorite: z.boolean() })` validates the
  request body at the route boundary.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Body missing `favorite` or non-boolean | Zod 400 via `withErrorHandling` |
| Topic id missing | `requireParam` → 400 |
| Topic not found OR owned by another user | `AppError("NOT_FOUND", 404)` (indistinguishable, per error-handling spec) |
| Unauthenticated | `requireActor` → 401 |

### 5. Good/Base/Bad Cases

- Good: owner toggles `{ favorite: true }` → row flips, `updatedAt` byte-identical to before.
- Base: toggling an already-`true` row to `true` is idempotent — write succeeds, no-op semantics.
- Bad: writing `updatedAt: new Date()` in the same `.set()` — see Wrong vs Correct.

### 6. Tests Required

- Integration (`topic.service.integration.test.ts`): toggle on/off persists;
  non-owner call → 404; **`updatedAt` unchanged** (assert equality against the
  pre-toggle value, re-read the raw row).
- Integration (`assistant.service.integration.test.ts`): tree exposes
  `isFavorite` without changing row order.
- UI (`AssistantTree.test.tsx`): Favorite section presence/absence (peer, above
  Topics), no duplication in
  normal rows, Topics label always visible, both collapse semantics,
  localStorage round-trip, star + menu toggles.

### 7. Wrong vs Correct

#### Wrong

```ts
// Favorite toggling is NOT conversation activity; bumping updatedAt
// re-sorts the topic to the top of the "last active" list.
await db.update(topics)
  .set({ isFavorite: input.favorite, updatedAt: new Date() })
```

#### Correct

```ts
await db.update(topics)
  .set({ isFavorite: input.favorite }) // updatedAt untouched
```

---

## `topics.updatedAt` semantics (general rule)

`topics.updatedAt` is the **last-active-time sort key** for the sidebar
(`selectTree` orders `desc(topics.updatedAt)`; requirement: favorites and the
normal list both sort by last activity).

- Bump it for conversation activity: new message, regenerate
  (`touchTopicUpdatedAt`, called from the chat/regenerate routes).
- Rename also bumps it today (historical behavior — a rename is user-visible
  activity, left as-is).
- Do NOT bump it for metadata-only mutations that carry no activity signal:
  favorite toggle (this spec). If you add another topic-level flag (pin,
  archive, mute…), decide explicitly and record the choice here.

---

## Frontend contract notes

- Optimistic toggle lives in `useSetTopicFavorite`
  (`src/components/assistant/use-assistants.ts`), modeled on
  `useSetAssistantDefaultModel`: cancel tree query → snapshot → flip
  `isFavorite` → guarded rollback → `onSettled` invalidate.
- The sidebar splits the single server-ordered list client-side
  (`favoriteTopics` / `otherTopics` filters). Favorites are moved, never
  duplicated, and the server ORDER BY is deliberately unchanged — a server-side
  `desc(isFavorite)` term would be redundant with the client split.
- Collapse state of the sidebar labels is **view chrome** (localStorage,
  `pika.sidebar.topic-sections`), not server state — see
  [State Management](../frontend/state-management.md).
