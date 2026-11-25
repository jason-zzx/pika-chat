# Temporary chat — implementation plan

## Order

1. Server data + filters
   - [x] `src/server/db/schema/assistant.ts`: `temporary` column, `topicColumns`; `pnpm db:generate`.
   - [x] `src/lib/schemas/topic.ts`, `src/lib/schemas/chat.ts`: `temporary` on Topic / request.
   - [x] `generation-turn.ts` / `generation.service.ts`: carry `temporary` to the lazy insert; `titleCandidate = false`.
   - [x] `topic.service.ts`: list/favorites filters, rename/favorite guard, extract delete core, `purgeIdleTemporaryTopics`.
   - [x] `search.service.ts`, `assistant.service.ts` (`topicCount`) filters.
   - [x] `generation-runner.ts`: call the sweep in `sweepQueued`.
   - [x] Integration tests: list/favorites/search/count exclusion, rename/favorite 404, no auto-title, sweep keeps <24h and removes >24h with files.
2. Web
   - [x] Temporary store + leave guard in `src/app/(app)/layout.tsx` (pathname change, same-route leave trigger, `pagehide` keepalive, bridge mirror).
   - [x] ChatView + topic page: draft toggle (stays visible during active temp chat to exit), `temporary` in send body, keep draft URL without `history.replaceState` or `recordPromotedTopic`, redirect direct `/assistant/:a/:t` temporary URLs to draft, header label + banner.
   - [x] `composer-store.ts`: no persistence for temporary + `clearTemporaryDrafts`.
   - [x] `src/global.d.ts`: `setTemporaryTopic?`; `messages/en.json` + `messages/zh-CN.json` keys.
   - [x] Tests for the guard (leave → DELETE once, same-route reset, StrictMode-safe) using the real store.
3. Desktop shell
   - [x] `preload-remote.ts` bridge method; `main.ts` IPC handler, delete helper, `closeRemote` + `before-quit` with timeout.
4. Android shell
   - [x] `RemoteBridge.kt` message + injected method; pending pref; `MainActivity.kt` flush points.
5. Finish
   - [x] Spec updates (Phase 3): `guides/native-shell.md` bridge method, `backend/topic-list-pagination.md` + `search.md` exclusion, new temporary-chat contract notes.

## Validation

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --dir native -r typecheck   # desktop + shell-ui (check native/package.json for the exact script)
cd native/mobile/android && ./gradlew assembleDebug
```

Manual:
- Browser: toggle → send → sidebar/search clean → new chat → topic gone; reload deletes.
- Desktop remote + local: quit with a temp chat open → gone on relaunch; tray hide keeps it.
- Android: swipe away → relaunch → gone.

## Rollback points

Each numbered step is independently revertible. Step 1 is safe to ship alone (nothing creates temporary topics yet), and steps 3–4 are no-ops against servers without step 2.
