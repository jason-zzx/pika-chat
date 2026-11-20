# Implementation plan

## Ordered checklist

1. **Schema + migration**
   - [ ] `src/server/db/schema/assistant.ts`: replace `topics_assistant_id_idx` with `topics_assistant_list_idx (assistant_id, is_favorite, updated_at desc, id desc)`.
   - [ ] `pnpm db:generate` and commit the generated SQL + snapshot.
2. **Shared schemas**
   - [ ] `src/lib/schemas/assistant.ts`: `topics` → `topicCount`.
   - [ ] `src/lib/schemas/topic.ts`: `topicPageSchema`, `favoriteTopicsSchema`, `topicDetailSchema.assistantId`.
3. **Services**
   - [ ] `assistant.service.ts`: `selectTree` / `groupTree` / `toAssistant` → grouped count, with no topic rows.
   - [ ] `topic.service.ts`: `listTopicPage(assistantId, cursor, actor)` (keyset, µs-precise cursor) and `listFavoriteTopics(assistantId, actor)`. Both call `requireOwnedAssistant` first.
   - [ ] `findTopicDetailForActor` projects `assistantId`.
4. **Routes**
   - [ ] `src/app/api/assistants/[id]/topics/route.ts` (decode and validate the cursor at the boundary).
   - [ ] `src/app/api/assistants/[id]/topics/favorites/route.ts`.
5. **Client API + hooks**
   - [ ] `src/lib/api/topic.ts`: `listTopicPage`, `listFavoriteTopics`.
   - [ ] `use-assistants.ts`: keys, `useTopicPages`, `useFavoriteTopics`, optimistic favorite move, rename also invalidates `topicKeys.all`.
6. **Consumers** (design §3 table)
   - [ ] `ChatView.tsx` header title and the post-regenerate invalidation.
   - [ ] `ChatPoolBridge.tsx` invalidations, notification, titled check.
   - [ ] `DeleteAssistantDialog.tsx` count.
   - [ ] `AssistantTree.tsx` leave-after-delete.
7. **Age formatter**
   - [ ] `src/lib/topic-age.ts` + `topic-age.test.ts` (every boundary).
   - [ ] i18n keys in `messages/en.json` and `messages/zh-CN.json`.
8. **Pane + row UI** (`AssistantTree.tsx`): sections from the new hooks, sentinel auto-load, spinner/retry, minute clock, age label, hover-overlay actions (no layout width, opaque background), truncation-gated full-title tooltip, full-title menu header, long press.
9. **Tests**
   - [ ] `topic.service.integration.test.ts`: page size, `nextCursor` null on the last page, no dupes/skips after a touch between pages, same-millisecond `updated_at` ties, favorites excluded from pages, favorites list complete, foreign assistant 404.
   - [ ] `assistant.service.integration.test.ts`: `topicCount`, order.
   - [ ] `AssistantTree.test.tsx`: update the mocks to the new API functions. Cover: first page renders, sentinel loads the next page (stub `IntersectionObserver`, which jsdom lacks), retry on failure, favorites section from its own query, optimistic favorite move, age label rendered, long press opens the menu without navigating (touch `pointerdown` + fake timers), the long-press menu header shows the full title and the click-opened menu has none, the tooltip opens only when the title overflows (stub `scrollWidth`/`clientWidth`).
   - [ ] Update `ChatView*.test.tsx` and `ChatPoolBridge.test.tsx` fixtures that build `Assistant` with `topics`.
10. **Manual check**: run the app and verify AC11/AC12/AC14/AC15 at a desktop width with a mouse, and in Chrome device emulation (touch) and/or the Android emulator.

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Risky files / rollback points

- `use-assistants.ts` optimistic favorite move: highest logic risk. Keep the snapshot/restore guard.
- `ChatPoolBridge.tsx`: notification and title-wait flow. Regression-test with the existing `ChatPoolBridge.test.tsx`.
- The migration is a separate commit-able unit. Rollback = revert the commit and drop the new index / recreate the old one.

## Before `task.py start`

- [ ] User approves the planning summary.
- [ ] `implement.jsonl` / `check.jsonl` curated.
