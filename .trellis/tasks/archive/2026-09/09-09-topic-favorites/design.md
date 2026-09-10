# Design — Topic Favorites

## Overview

Add an `is_favorite` boolean to topics, a `PATCH /api/topics/[id]/favorite` Route Handler backed by a `setTopicFavorite` service, expose `isFavorite` through the assistant tree query, and restructure the sidebar topic list client-side into two peer collapsible sections — "Favorite" pinned above "Topics" (hidden when empty, favorites never duplicated below) — with collapse state persisted globally in localStorage. Toggle entry points: "..." dropdown item + hover star button on the topic row.

## Data Model & Migration

- `topics` gains `isFavorite: boolean("is_favorite").notNull().default(false)` (`src/server/db/schema/assistant.ts:30-42`).
- Migration generated via `pnpm db:generate` (output under `src/server/db/migrations/`), never hand-written. Existing rows default to `false` — backfill is free.
- Schema files must NOT import `server-only` (drizzle-kit constraint, per backend spec).

Rationale: topics have a single-owner chain (topic → assistant → `ownerId`), so a per-row boolean is sufficient. A user-favorites join table would only matter if topics could be shared across users — they cannot.

## Shared Contract (Zod)

`src/lib/schemas/topic.ts`:

- `topicSchema` gains `isFavorite: z.boolean()`.
- New `setTopicFavoriteSchema = z.object({ favorite: z.boolean() })`, exported with its `SetTopicFavoriteInput` type.

Every place that materializes a `Topic` must now include `isFavorite`: `selectTree` (`src/server/services/assistant.service.ts:100-106` topic select), `createTopicForChat` / `renameTopic` / `findTopicForActor` returning clauses (`src/server/services/topic.service.ts`), and any admin/topic API responses validated by `topicSchema`.

## API

New Route Handler `src/app/api/topics/[id]/favorite/route.ts`:

- `PATCH` → `withErrorHandling` + `requireActor` (accepts session cookie AND bearer token) + `setTopicFavoriteSchema.parse(await request.json())` → `setTopicFavorite(id, input, actor)` → `Response.json(topic)`.
- Mirrors the existing `/title` subresource route shape (`src/app/api/topics/[id]/title/route.ts`), keeping `PATCH /api/topics/[id]` strictly rename.

Why a subresource PATCH instead of extending the rename PATCH: the existing PATCH body is `renameTopicSchema` (`{title}`); merging `{favorite?}` into it would entangle two unrelated mutations and complicate Zod parsing for no gain. A dedicated endpoint is idempotent, explicit, and matches the established `/title` precedent. Business capability stays HTTP-reachable (mobile-client constraint).

## Service Layer

New `setTopicFavorite(id, input, actor)` in `src/server/services/topic.service.ts`:

- `update(topics).set({ isFavorite: input.favorite })` — deliberately does NOT touch `updatedAt` (unlike `renameTopic`), because `updatedAt` is the last-active-time sort key and favorite toggling is not activity.
- Ownership: `where(and(eq(topics.id, id), inArray(topics.assistantId, ownedAssistantIds(actor))))` — same guard as `renameTopic`/`deleteTopic`; 404 `AppError` when no row.
- `logger.info({ userId, topicId, favorite }, "topic favorite toggled")` — no message content, follows logging spec.
- Returns the full updated `Topic` (including `isFavorite`).

Vitest: extend the service-layer test file covering topics with a `setTopicFavorite` case (toggle on/off, ownership rejection, `updatedAt` unchanged).

## Tree Query & Ordering

- `selectTree` adds `isFavorite: topics.isFavorite` to the topic projection. No `ORDER BY` change needed: it already returns topics `desc(topics.updatedAt)` per assistant. Favorite/normal split happens client-side from that single ordering — both sections therefore share last-active-time ordering (R4) with zero extra server logic.
- Adding a `desc(topics.isFavorite)` ordering term server-side was considered and rejected: the client must split into two labeled sections anyway, so server-side ordering would be redundant.

## Frontend

### Client API + hook

- `src/lib/api/topic.ts`: `setTopicFavorite(id, input)` → `PATCH .../favorite`, response parsed via `topicSchema`.
- `src/components/assistant/use-assistants.ts`: `useSetTopicFavorite` with optimistic update modeled on `useSetAssistantDefaultModel` (cancel tree queries → snapshot `previous` → `setQueryData` flipping `isFavorite` on the matching topic row across assistants → `onError` rollback only if state still reflects this mutation → `onSettled` invalidate `assistantKeys.all`). Optimistic is required for the hover-star click to feel instant (R5).

### UI — `AssistantPane` (`src/components/assistant/AssistantTree.tsx:277-374`)

- Compute `favoriteTopics = assistant.topics.filter(t => t.isFavorite)` and `otherTopics = assistant.topics.filter(t => !t.isFavorite)` (both already `updatedAt` desc from the server).
- Section structure — two PEER collapsible sections inside the single scrollable region, Favorite first, no nesting/indentation:

  ```
  Favorite          ▾   ← toggle button (rendered only when ≥1 favorite)
    ★ topic A
    ★ topic B
  Topics            ▾   ← toggle button, always rendered
    topic C
    topic D
  ```

- Rendering (single `SidebarGroup`, one scroll owner — the existing `SidebarGroupContent`, so both sections scroll together):
  - "Favorite" section renders first inside the scrollable content, only when `favoriteTopics.length > 0`: its own toggle label + collapsible row list. `=== 0` → today's plain list.
  - "Topics" section renders after it: toggle label always rendered (even when `otherTopics` is empty because everything is favorited) + collapsible row list.
  - Both labels use the SAME style — same font size/weight, identical left padding, `w-full justify-between` with the chevron at the right. No `pl-4`/indent subordination of one to the other. (The earlier nested-subcategory variant used an indented sub-label and was rejected by the user on visual review.)
  - Collapse scopes are INDEPENDENT: collapsing "Topics" hides only the normal rows; the Favorite section stays visible.
  - "No topics yet" `EmptyState` still gated on `assistant.topics.length === 0` total, rendered where the normal rows would be.
- Collapse implementation follows the app's established convention from `ToolCallShell` (`src/components/chat/ToolCallShell.tsx:100-157`):
  - Chevron: `ChevronDownIcon` with `rotate-180` when open / `rotate-0` when closed, `transition-transform duration-200 motion-reduce:transition-none`.
  - `aria-expanded` + `aria-controls={id}` where `id` comes from `useId`.
  - Smooth height animation via the `grid grid-rows-[1fr]/[0fr]` + inner `min-h-0 overflow-hidden` technique.
  - No `ui/collapsible.tsx` primitive exists in `src/components/ui/` — hand-rolled per the above, do NOT generate a new shadcn primitive for this.
- Collapse state: local `useState` in `AssistantPane` (default both expanded), persisted globally in localStorage (shared across assistants, one JSON object under a single key, e.g. `pika.sidebar.topic-sections` → `{"topics":true,"favorites":false}`). SSR/hydration safety follows the established pattern (`SearchModePicker.tsx:38-40`): never read localStorage during initial render — apply the persisted value in a `useEffect` after mount, write on every toggle. Do NOT add this to Zustand: it is view-local UI state, not server state.
- Extract the per-row markup into a small local `TopicRow` component (used by both the favorite rows and normal rows) to avoid duplicating the link + star + menu wiring: same `SidebarNavLink`, same dropdown (now with the favorite item first), plus the star action.
- Star button: `SidebarMenuAction` with `showOnHover` when NOT favorited; always visible when favorited. Icon `StarIcon` from lucide-react; filled variant uses `className="fill-current"` on the icon (stroke-based lucide icons render solid with current-color fill — matches the fill-vs-outline distinction preference; theme tokens only, no hard-coded colors). `aria-label`: `Favorite ${topic.title}` / `Unfavorite ${topic.title}`.
- Dropdown item: first item above Rename — "Favorite" (outline star) / "Unfavorite" (filled star), not destructive-styled.
- Both entry points call the same `useSetTopicFavorite` mutation; no local state.
- Icon-collapse mode (`group-data-[collapsible=icon]`): `SidebarGroupLabel`'s built-in styles already hide labels (`-mt-8 opacity-0`); verify the new toggle buttons don't break that mode (visual check).

### Test fixture impact

- `src/components/assistant/AssistantTree.test.tsx` topic fixtures must add `isFavorite: false` once `Topic` requires it; the `@/lib/api/topic` mock gains `setTopicFavorite`; new test cases: favorite/unfavorite render the subsection, collapse toggles, all-favorited keeps the Topics label.

### Component boundaries

- `AssistantTree.tsx` stays the only file touched for UI; it is already `"use client"` and owns dialog state. `TopicRow` stays local to that file unless it grows — no premature extraction to `src/components/topic/`.

## Compatibility & Rollout

- Additive DB column with default — no backfill, no downtime. Rollback = drop column (or just stop rendering favorites; stale `true` values are inert).
- API is additive; existing consumers (`topicSchema.parse`) gain a required `isFavorite` field, so old clients parsing with the NEW schema are fine, but any cached payload parsed with the new schema from an old endpoint would fail — not applicable here since schema and endpoint ship together in one deploy.
- `renameTopic`/title-generation responses now include `isFavorite`; `applyTitledTopic` merges with spread (`{ ...row, ...topic }`) so it picks the field up automatically.

## Trade-offs & Rejected Alternatives

- **Join table `user_topic_favorites`** — rejected: single-owner topics make it over-modeling.
- **Server-side favorite-first ordering in SQL** — rejected: client must split sections anyway; would complicate the query for no behavioral gain.
- **Extending rename PATCH body** — rejected: entangles unrelated mutations; `/favorite` subresource matches `/title` precedent.
- **Local-only persistence (localStorage)** — rejected: violates server-authoritative state constraint and breaks multi-device.
