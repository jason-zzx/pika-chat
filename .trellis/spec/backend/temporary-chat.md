# Temporary Chat

> Ephemeral conversations backed by persisted `topics` rows (`temporary = true`)
> so generation, stop/resume, versions, attachments, and compression work
> unchanged while leaving no trace in history, search, or browser URLs.
> Landed in `11-24-temporary-chat`.

---

## Scenario: creating, isolating, and deleting a temporary chat

### 1. Scope / Trigger

Database schema & migration change (`topics.temporary`), cross-layer Zod schema
changes (`chatRequestSchema`, `topicSchema`), service visibility/mutation guards,
hourly server sweep, URL-less web lifecycle, and native shell bridge method
(`window.pikaNative.setTemporaryTopic`).

### 2. Signatures

- DB (`src/server/db/schema/assistant.ts`, migration `0002`):
  - `topics.temporary`: `integer("temporary", { mode: "boolean" }).notNull().default(false)`
  - Projected by `topicColumns`. Immutable after insert.
  - Excluded from v0.4.2 PostgreSQL boot import (`IMPORT_TABLES` in
    `src/server/db/import-postgres.ts`) so imported rows default to `false`.
- Schemas:
  - `chatRequestSchema.temporary?: boolean` (`src/lib/schemas/chat.ts`)
  - `topicSchema.temporary: boolean` (`src/lib/schemas/topic.ts`)
- Services (`src/server/services/topic.service.ts`):
  - `TEMPORARY_TOPIC_TTL_MS = 24 * 60 * 60 * 1000`
  - `purgeIdleTemporaryTopics(now?: Date): Promise<number>` (called from
    `sweepQueued` in `src/server/ai/generation-runner.ts` alongside
    `purgeTerminalGenerations`)
  - `deleteFilesIfUnreferenced(ids: string[], actor: Pick<Actor, "userId">)`
    (`src/server/files/file.service.ts`) so the sweep passes the assistant owner.
- Client API (`src/lib/api/topic.ts`):
  - `deleteTopicBestEffort(id: string, options?: { keepalive?: boolean }): Promise<void>`
- Native bridge (`src/global.d.ts`):
  - `PikaNative.setTemporaryTopic?(topicId: string | null): void`

### 3. Contracts

- **Creation & hashing**: `chatRequestSchema.temporary` is honored only on the
  lazy-insert branch (`topicId === null`) in `acceptTurn`
  (`src/server/services/generation.service.ts`) and ignored when `topicId` is
  present. `sendRequestHash` includes `temporary` only when `!request.topicId`.
- **Visibility & mutations**:
  - `listTopicPage`, `listFavoriteTopics`, `searchForActor` (both topic-title
    and message queries), and `selectTree` (`topicCount` left join) filter
    `topics.temporary = false`.
  - `renameTopic` and `setTopicFavorite` include `eq(topics.temporary, false)`
    in their `WHERE` clause, so temporary topics return 404 `topic.notFound`.
  - `findTopicForActor`, `findTopicDetailForActor`, `findTopicContextForActor`,
    and `DELETE /api/topics/:id` continue to resolve temporary topics for the
    active session and shell cleanup.
- **No auto-titling**: `prepareSendTurn` and `prepareRegenerateTurn` set
  `titleCandidate = false` when creating or targeting a temporary topic;
  `titleTopicFromFirstMessage` returns early when `topic.temporary` is true.
- **24h idle sweep**: `purgeIdleTemporaryTopics(now)` finds
  `temporary = true AND updated_at < now - 24h` across all users and deletes
  each via shared `deleteTopicCore` (re-checking `temporary = true` and the
  cutoff inside the immediate transaction, marking generations target-deleted,
  deleting the row, aborting the local producer, and releasing unreferenced
  attachment files).
- **Web URL-less lifecycle**:
  - Temporary chats stay on the current draft URL (`/` or `/assistant/:a`):
    `ChatView` skips `window.history.replaceState` and
    `appNav.recordPromotedTopic` when `draftTemporary` is true.
  - Direct requests to `/assistant/[assistantId]/[topicId]` where
    `context.topic.temporary` is true redirect immediately to
    `/assistant/[assistantId]` (and `generateMetadata` returns `{}`).
  - Leaving deletes immediately via `TemporaryTopicGuard` (mounted in
    `src/app/(app)/layout.tsx`):
    - pathname change (`usePathname()` diff against ref, StrictMode-safe);
    - same-route leave trigger (`useTemporaryTopicStore.requestLeaveTemporaryTopic()`,
      wired to sidebar "New topic", home brand link, and the active header
      temporary toggle);
    - `pagehide` (`deleteTopicBestEffort(id, { keepalive: true })`);
    - `signOutAndReset()` awaits `deleteTopicBestEffort(id)` *before*
      `authClient.signOut()` while the session cookie is still valid, then
      clears the store and notifies `window.pikaNative?.setTemporaryTopic?.(null)`.
  - Pre-`data-topic` abandonment: `chat-pool` tracks `entry.temporary` (set by
    `noteSendStarted(chatId, isTemporary)`). If the view detaches or
    `abandonTemporaryDraft()` runs before `data-topic` arrives, `onData` marks
    the entry discarded and immediately fires `deleteTopicBestEffort(topicId)`.
    Active temporary entries also skip `bridge?.onTopicAnnounced` and desktop
    `bridge?.notifyReplyFinished`.
  - Composer drafts under `temp-*` keys never write to `localStorage` and are
    wiped via `clearTemporaryDrafts()` on toggle-off, leave, or unmount.
- **Native shells**: see [Native Shell](../guides/native-shell.md) for the
  desktop IPC / `closeRemote` / `before-quit` and Android pref / flush rules.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| `PATCH /api/topics/:id` (rename) on temporary topic | 404 `topic.notFound` |
| `PATCH /api/topics/:id/favorite` on temporary topic | 404 `topic.notFound` |
| `POST /api/topics/:id/title` on temporary topic | 200 no-op (default title preserved, no LLM call) |
| Direct `GET /assistant/:a/:t` for temporary topic | 307 redirect to `/assistant/:a` |
| `DELETE /api/topics/:id` already deleted by page or shell | 404 treated as success by best-effort / shell callers |

### 5. Good/Base/Bad Cases

- Good: toggle temporary on `/` or `/assistant/:a` → send multi-turn messages
  with attachments → URL stays on draft route, sidebar/search/counts stay
  clean → reload lands cleanly on an empty draft and deletes the topic + files.
- Base: user sends a follow-up on a temporary chat (refreshing `updatedAt`);
  hourly sweep keeps temporary topics active within 24h and removes those idle
  for >24h together with unreferenced files.
- Bad: promoting a temporary chat to `/assistant/:a/:t` via `history.replaceState`
  — reload races `GET /assistant/:a/:t` against the `keepalive` `DELETE` and
  strands the user on a 404 / load-failed view, while leaking an ephemeral id
  into browser history and bookmarks.

### 6. Tests Required

- `topic.service.integration.test.ts`: list/favorites exclusion, rename &
  favorite 404, `purgeIdleTemporaryTopics` removes >24h with files and keeps
  <24h and normal topics.
- `search.service.integration.test.ts`: excludes temporary topics from both
  title and message search.
- `assistant.service.integration.test.ts`: excludes temporary topics from
  `topicCount`.
- `generation-runner.integration.test.ts`, `generation-turn.test.ts`,
  `title.service.test.ts`: no auto-titling across initial send, follow-up,
  regenerate, or direct title endpoint; `sendRequestHash` distinction.
- `import-postgres.test.ts`: v0.4.2 PostgreSQL import skips `topics.temporary`
  and defaults imported rows to `0`.
- `page.test.ts`, `TemporaryTopicGuard.test.tsx`, `ChatView.test.tsx`,
  `chat-pool.test.tsx`, `sign-out.test.ts`, `composer-store.test.ts`: direct
  URL redirect, StrictMode-safe leave/same-route/`pagehide`/bridge mirror,
  URL-less turns, pre-`data-topic` abandonment, pre-sign-out delete order,
  unpersisted `temp-*` drafts.

### 7. Wrong vs Correct

#### Wrong

```ts
// Promotes temporary topic id into the address bar; reload races GET vs keepalive DELETE
window.history.replaceState(null, "", assistantTopicHref(assistant, streamTopicId));
```

#### Correct

```ts
// Temporary chats stay on the draft URL; direct /assistant/:a/:t visits redirect to draft
if (draftTemporary) {
  return;
}
window.history.replaceState(null, "", assistantTopicHref(assistant, streamTopicId));
appNav.recordPromotedTopic(assistant, streamTopicId);
```
