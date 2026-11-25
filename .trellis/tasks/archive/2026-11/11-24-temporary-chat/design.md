# Temporary chat — design

## Model

A temporary chat is a normal persisted topic with `topics.temporary = true`. Everything that runs a turn (admission, background runner, stop/resume, regenerate/edit versions, attachments, compression) is reused unchanged. Only visibility and lifetime differ. Deletion always goes through the existing topic-delete core, which marks generations target-deleted, removes rows, aborts the local producer, and releases unreferenced files.

## Server

- Schema: `topics.temporary` integer boolean, not null, default false; migration via `pnpm db:generate`. `topicColumns` (and so `Topic` / `TopicDetail`) gains `temporary`.
- Creation: `chatRequestSchema` gains `temporary?: boolean`. It is used only on the lazy-insert branch (`generation.service.ts:392`, `topicId === null`) and ignored for an existing topic. The flag is immutable after insert.
- No title: the prepared turn sets `titleCandidate = false` when the turn creates a temporary topic or targets an existing one (`generation-turn.ts:233,241,446`).
- Visibility filters (`temporary = false`): `listTopicPage`, `listFavoriteTopics`, both `search.service.ts` queries, and the `topicCount` left join (`assistant.service.ts:47`). `renameTopic` / `setTopicFavorite` add the same condition to their `where`, so a temporary topic answers 404 `topic.notFound`. `findTopicForActor` / detail / history / `DELETE` are unchanged, because the chat page and the shells need them.
- Sweep: `purgeIdleTemporaryTopics(now)` in `topic.service.ts` selects `temporary = 1 AND updated_at < now - 24h` (all users) and deletes each through the same core as `deleteTopic`. That core is extracted from `deleteTopic` because it now has two callers. File release currently takes an `Actor`; the sweep passes the owner resolved from the topic's assistant. Wired into `sweepQueued` next to `purgeTerminalGenerations` (hourly: `PURGE_EVERY_SWEEPS × SWEEP_INTERVAL_MS`).

## Web

- URL policy: a temporary chat stays on the current draft URL (`/` or `/assistant/:a`) and never calls `history.replaceState` or `appNav.recordPromotedTopic`. Direct visits to `/assistant/:a/:t` where `topic.temporary` is true redirect immediately to `/assistant/:a` (and return empty metadata). Reloads and bookmarks therefore always target a clean draft URL rather than an ephemeral topic id.
- Draft toggle: ChatView draft state (home and assistant draft) shows a temporary toggle. Sends from a draft include `temporary: true` when it is on. Once a temporary chat is created, the toggle stays visible in its active state so clicking it exits and deletes the temporary chat back to a fresh draft (hidden on normal topics).
- Banner and header: when the active topic (or the toggled draft) is temporary, the header shows the temporary-chat label instead of the title, plus a "not saved" notice. Desktop reply notifications are skipped for temporary chats.
- Active temporary topic: a tiny client store holds `temporaryTopicId` and a same-route `leaveRequestCount` trigger. ChatView sets `temporaryTopicId` when `data-topic` arrives for a temporary send, and resets to a clean draft when a same-route leave trigger fires or the assistant changes.
- Leave guard: one component mounted in `src/app/(app)/layout.tsx` owns leave detection.
  - When `usePathname()` changes or a same-route leave trigger fires (sidebar "New topic", home brand link, or the header temporary toggle), it sends `DELETE /api/topics/:id`, discards the pooled chat, clears temporary composer drafts and query caches, and clears the store. Comparing ref values instead of using effect cleanup keeps React StrictMode double-effects from deleting.
  - On `pagehide` it sends `fetch(…, { method: "DELETE", keepalive: true })` (D5: reload counts as leaving).
  - On sign-out (`sign-out.ts`), it awaits `DELETE /api/topics/:id` while the session cookie is still valid and clears native tracking on confirmed logout.
  - If the user leaves before the first `data-topic` arrives, `chat-pool` discards and deletes the temporary topic as soon as `data-topic` arrives on the detached temporary entry.
  - It mirrors the store into `window.pikaNative?.setTemporaryTopic?.(id | null)`.
- Drafts: `composer-store` skips `localStorage` persistence for `temp-*` keys and clears all temporary draft state on toggle-off, leave, or unmount.

## Shell bridge contract

```ts
interface PikaNative {
  // …existing
  /** Topic id of the temporary chat open in this page, or null. Optional: older shells lack it. */
  setTemporaryTopic?(topicId: string | null): void;
}
```

The shell deletes with the page's own cookies: `DELETE <server origin>/api/topics/<id>`. A 404 means the chat is already gone and counts as success. The web leave guard and the shell may both fire.

### Desktop (`native/desktop`)

- `preload-remote.ts`: `setTemporaryTopic` → `ipcRenderer.send("native:temporaryTopic", id)`.
- `main.ts`: the handler accepts only the current remote view's sender, parses `z.string().max(64).nullable()`, and stores it on `remote.temporaryTopicId`. A delete helper calls `session.fromPartition(remote.partition).fetch(origin + path, { method: "DELETE" })`.
  - `closeRemote` (server switch / remove / URL change): fire-and-forget delete.
  - `before-quit`: await the delete, bounded by a short timeout so an unreachable server cannot block quit, then `localServer.shutdown()`. Local mode therefore deletes before its server stops. Hiding to the tray is not quitting.
  - Crash or force kill: left to the 24h sweep.

### Android (`native/mobile`)

- `RemoteBridge.kt`: `setTemporaryTopic` posts `{ type: "temporaryTopic", topicId }`. The handler validates it (string ≤ 64 or null) and persists `{ origin, topicId }` as a pref, or clears it.
- `MainActivity.kt` flushes the pending pref (D6) on a background thread with `PikaHostPlugin.openConnection(url, "DELETE", cookie)` + `CookieManager` cookie, then clears it whatever the result (the sweep is the backstop). Flush points:
  - `onCreate` (next launch after a swipe-away or system kill);
  - `onDestroy` when `isFinishing` (back at the root on Android ≤ 11);
  - before `destroyRemoteWebView` on a server switch.
- Backgrounding (onStop) does not delete.

## Trade-offs

- Persisted flag instead of a client-only chat: one extra column and a few filters, versus a second stateless generation path that would lose resume/stop/versions/attachments.
- Keeping the draft URL (`/` or `/assistant/:a`) instead of promoting to `/assistant/:a/:t`: reload always lands directly on a clean draft with no GET-vs-keepalive-DELETE race, and bookmarks/browser history never capture an ephemeral topic id. Same-route exit actions (New topic, home logo, header toggle) explicitly trigger store-driven teardown.
- Shells hold one temporary topic per server view. Leave-delete keeps at most one open at a time; anything missed falls to the sweep.

## Rollback

The column defaults to false, so reverting the code leaves old temporary rows behaving as normal topics. The sweep or a manual delete removes them. Shells check that the bridge method exists, so a new shell on an old server never calls it.
