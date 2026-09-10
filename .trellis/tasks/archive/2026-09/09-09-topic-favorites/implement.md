# Implement — Topic Favorites

Execution order follows the data flow bottom-up so each step typechecks against the last. Validate after each numbered step; all commands from repo root.

## Checklist

### 1. Schema + migration

- [ ] Add `isFavorite: boolean("is_favorite").notNull().default(false)` to `topics` in `src/server/db/schema/assistant.ts` (import `boolean` from `drizzle-orm/pg-core`; no `server-only` import in schema files).
- [ ] Run `pnpm db:generate`; commit the generated SQL + snapshot under `src/server/db/migrations/`.
- [ ] Apply: `pnpm db:migrate` (local dev DB).

### 2. Shared Zod contract

- [ ] `src/lib/schemas/topic.ts`: add `isFavorite: z.boolean()` to `topicSchema`; add `setTopicFavoriteSchema` (`{ favorite: z.boolean() }`) + `SetTopicFavoriteInput` type export.

### 3. Service layer

- [ ] `src/server/services/topic.service.ts`: add `setTopicFavorite(id, input, actor)` — updates only `isFavorite` (NOT `updatedAt`), ownership via `inArray(topics.assistantId, ownedAssistantIds(actor))`, 404 `AppError` when missing, `logger.info` with `{ userId, topicId, favorite }`, returns full `Topic`.
- [ ] Update all `Topic`-returning clauses (`createTopicForChat`, `renameTopic`, `findTopicForActor`) to project `isFavorite`.
- [ ] `src/server/services/assistant.service.ts`: add `isFavorite: topics.isFavorite` to the `selectTree` topic projection (~line 101-106).

### 4. API route

- [ ] Create `src/app/api/topics/[id]/favorite/route.ts`: `PATCH` with `withErrorHandling` + `requireActor` + `setTopicFavoriteSchema.parse(await request.json())` → `setTopicFavorite`, returns `Response.json(topic)`. Mirror `src/app/api/topics/[id]/title/route.ts` structure (incl. the `requireParam` helper for `id`).

### 5. Client API + hook

- [ ] `src/lib/api/topic.ts`: add `setTopicFavorite(id, input): Promise<Topic>` (PATCH, `topicSchema.parse`).
- [ ] `src/components/assistant/use-assistants.ts`: add `useSetTopicFavorite` — optimistic tree update (flip `isFavorite` on the matching topic row), `onError` rollback guarded by "state still reflects this mutation", `onSettled` invalidates `assistantKeys.all`. Model on `useSetAssistantDefaultModel` (lines 67-127).

### 6. Sidebar UI

- [ ] `src/components/assistant/AssistantTree.tsx` — `AssistantPane`:
  - [ ] Split topics: `favoriteTopics` / `otherTopics` (server order preserved).
  - [ ] Restructure into two PEER sections (Favorite above Topics, same level, no indentation) — this replaces the nested-subcategory layout from the previous pass:
    - [ ] Inside the existing scrollable `SidebarGroupContent`, render the Favorite section FIRST (only when `favoriteTopics.length > 0`): toggle label + collapsible favorite rows.
    - [ ] Then render the Topics section: toggle label ALWAYS rendered (even when every topic is favorited and its list is empty) + collapsible normal rows (or the empty state).
    - [ ] Both labels identical in style: same font size/weight/left padding, `justify-between` with the chevron right-aligned. Remove any `pl-4` sub-label indentation and any nesting of the Favorite block inside the Topics collapse container.
    - [ ] Collapse scopes independent: Topics toggle controls only normal rows; Favorite toggle controls only favorite rows.
  - [ ] Collapse mechanics per `ToolCallShell` convention: `ChevronDownIcon` rotate-180-when-open, `transition-transform duration-200 motion-reduce:transition-none`, `aria-expanded`/`aria-controls` (`useId`), `grid-rows-[1fr]/[0fr]` height animation. No new shadcn primitive.
  - [ ] Keep `EmptyState` ("No topics yet") gated on `assistant.topics.length === 0`; it sits where the normal rows would be.
  - [ ] Collapse state: both default expanded, persisted globally to localStorage (single key `pika.sidebar.topic-sections`, JSON `{topics, favorites}`). Read it with `useSyncExternalStore` (module-level cache + server snapshot = defaults) — NOT `useState` + a `useEffect` read: `react-hooks/set-state-in-effect` is an error in this repo. Keeping the existing module-level store in `AssistantTree.tsx` is correct; only the render tree changes. Shared across all assistants.
  - [ ] Extract local `TopicRow` component (link + star action + dropdown) reused by favorite and normal rows.
  - [ ] Star `SidebarMenuAction`: `showOnHover` when unfavorited, always visible when favorited; `StarIcon`, filled via `fill-current` class when favorited; `aria-label` `Favorite/Unfavorite ${topic.title}`; `onClick` → `useSetTopicFavorite`.
  - [ ] Dropdown gains first item "Favorite"/"Unfavorite" (with star icon, non-destructive) above Rename; calls same mutation.
  - [ ] `group-data-[collapsible=icon]` sidebar icon-collapse mode must not regress (label buttons need `group-data-[collapsible=icon]:hidden` or they stay focusable while invisible; star/menu actions gracefully handled).
- [ ] `src/components/assistant/AssistantTree.test.tsx`:
  - [ ] Add `isFavorite: false` to all topic fixtures (type now requires it).
  - [ ] Add `setTopicFavorite` to the `@/lib/api/topic` mock.
  - [ ] New cases: favorite renders in the Favorite section and is not duplicated in the normal rows; Favorite section appears ABOVE the Topics section at the same level; all-favorited keeps the Topics label visible with an empty list; no favorites → no Favorite section; Favorite collapse hides only favorites; Topics collapse hides only normal rows and LEAVES the Favorite section visible; collapse state round-trips through localStorage for both toggles.

### 7. Tests

- [ ] Service test: `setTopicFavorite` — toggles on/off; non-owner gets 404; `updatedAt` unchanged by toggle; returned row includes `isFavorite`.
- [ ] Run full suite.

## Validation Commands

```bash
pnpm db:generate && pnpm db:migrate   # step 1
pnpm typecheck                        # after every step
pnpm lint
pnpm test
pnpm dev                              # manual visual pass in browser
```

Manual visual pass (user reviews in browser — expect a round of visual corrections per project history):
- no favorites → list identical to today (Topics toggle aside);
- favorite via star and via menu → instant move into the pinned Favorite section ABOVE Topics, filled star;
- un-favorite last → Favorite section disappears;
- all topics favorited → Topics label still visible below with an empty list;
- Favorite/Topics collapse independently, arrows animate, both operable by keyboard;
- active chat in a favorited topic → re-sorts to top of Favorite section;
- reload → favorite state persists (and collapse state, if persistence chosen);
- mobile breakpoint + icon-collapsed sidebar still render correctly.

## Risky Files / Rollback Points

- `src/server/db/schema/assistant.ts` + generated migration — rollback: revert schema, drop column migration.
- `src/components/assistant/AssistantTree.tsx` — largest UI diff; `TopicRow` extraction must preserve existing rename/delete wiring and `aria-current` behavior.
- `topicSchema` gaining required `isFavorite` — every `topicSchema.parse` consumer must receive the field; grep `topicSchema.parse` and `Topic` constructions before finishing.

## Pre-start Gate

- [ ] prd.md / design.md / implement.md reviewed by user.
- [ ] `implement.jsonl` + `check.jsonl` curated with real spec/research entries.
