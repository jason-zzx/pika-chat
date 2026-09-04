# Chat Message Versions

> Cross-layer contract for regenerating assistant answers as switchable,
> persisted versions, and for single-message deletion. Landed with
> `09-04-chat-message-regenerate-delete`. Complements
> [Chat Message Metadata](./chat-message-metadata.md).

## Scenario: message versioning and single-message mutation

### 1. Scope / Trigger

Any work touching answer regeneration, the version switcher, version
selection, or message deletion. The version model lives on `chat_messages`;
getting the invariants wrong corrupts what the model sees as context.

### 2. Data Model

- `chat_messages.group_id` (text, NOT NULL): the version group. A new
  message forms a single-version group with `group_id = id`; regenerated
  versions inherit the target group's id. Backfilled `group_id = id`.
- `chat_messages.is_selected` (boolean, NOT NULL, default true): the
  persisted current version of the group.
- Partial unique index `chat_messages_selected_version_idx` on
  `(group_id) WHERE is_selected` — **at most one selected version per
  group**. Every selection change must deselect siblings first, in the
  same transaction, or the insert violates the index.
- No version-number column: `versionIndex` is derived from the
  `createdAt, id` ordering inside the group (versions are append-only, so
  the rank is stable).
- Group display position = the group's earliest version's `createdAt`.
  Regenerating never reorders the conversation.

### 3. Contracts

- `listTopicMessages` returns the **selected-version view**: one message
  per group, ordered by group position. `/api/chat` history building, the
  history HTTP API, and the frontend seed all consume this one function,
  so "only the selected version enters model context" holds everywhere by
  construction. Never bypass it with a raw row query for context.
- Selection fallback: if a group has no `is_selected` row (legacy or
  partial writes), the latest version wins (`selectedRowOf`).
- Version metadata (`groupId`, `versionIndex`, `versionCount`,
  `versionIds`) rides in `chatMetadataSchema` — all optional,
  **assistant rows only**; user messages are always single-version groups.
  Live-streamed regenerate messages omit it; the view converges on reseed.
- `resolveRegenerateTarget({ topicId, messageId })`:
  - assistant message → its group; history = selected messages in groups
    before it.
  - user message → the *immediately following* assistant group if one
    exists, else a new answer slot; history = selected messages up to and
    including that user message.
  - Regenerating or deleting never truncates later messages (product
    decision D1).
- `deleteMessage` removes exactly one row. Deleting the selected version
  re-selects the newest remaining version in the same transaction;
  deleting the last version removes the slot. The topic survives an empty
  conversation.
- Endpoints (all topic-scoped, ownership via `requireOwnedTopic` +
  `topicId` in every WHERE; foreign id → `NOT_FOUND`):
  - `DELETE /api/topics/[id]/messages/[messageId]` → 204
  - `POST .../select` → 204
  - `POST .../regenerate` → UI message stream; mirrors the `/api/chat`
    skeleton (availability check → `createChatModelHandle` →
    `registerStream` → `streamText` → `createUIMessageStream` → `onEnd`
    persists with `groupId`). **No** topic creation, user-message append,
    or title trigger. Stopped/failed outcomes persist as versions too.
- The regenerate stream carries no `data-topic` chunk: the client reads
  the stream id from the `x-pika-stream-id` response header instead.
  Stop reuses `POST /api/chat/stop`.

### 4. Frontend Contract

- Regenerate does **not** go through `useChat.sendMessage` (that appends
  a user message). `ChatView` consumes the response with
  `parseJsonEventStream` + `uiMessageChunkSchema` + `readUIMessageStream`
  and folds frames in via `setMessages`: replace-in-place for assistant
  targets, insert-after for user targets.
- **Message-id contract (B6)**: both streaming routes run with
  `sendStart: true` so the streamed assistant message id equals the row
  `onEnd` persists. Follow-up actions (regenerate/delete/select) reference
  that id. A stop/abort can still release the client before persistence
  finishes, so every action first runs `resolveServerMessageId`
  (`sync-message.ts`): fetch fresh (never cached) history, retry once
  after 400ms, and surface a retryable "still being saved" error instead
  of POSTing a doomed id. User messages skip this entirely (client-chosen
  ids, persisted before streaming). Genuinely unknown ids still 404.
- **Immediate thinking shimmer (R7)**: on regenerate click the answer slot
  is swapped for an empty placeholder assistant message *before* the POST
  (`buildRegenPlaceholder`/`insertRegenPlaceholder` in
  `regenerate-stream.ts`); the first stream frame replaces it, a
  start-failure restores the original, teardown reseed cleans the rest.
  The placeholder carries the group's `groupId` so React keys and the
  reveal state survive the handoff.
- **GroupId keying (B1)**: `MessageList` keys items and the tap-reveal
  state by `metadata.groupId ?? id`, never by the per-version message id
  — switching/deleting versions swaps in a different-id row, and id-keying
  remounts the item and drops local state.
- **Single-active tap reveal (R9)**: `MessageList` owns one `revealedKey`;
  tapping a message reveals its timestamp/actions/switcher rows until a
  different message is tapped (no toggle-off). Menu-open and the 2s copy
  feedback keep the row visible via `data-revealed`. Desktop
  hover/focus-within is independent and unchanged.
- **Effective topic id (B8)**: a topic created mid-session reaches the URL
  via `history.replaceState`, which does not re-render the route — the
  `topicId` prop stays `undefined`. Everything needing the topic (history
  query, seeds, invalidations) uses `activeTopicId = topicId ??
  createdTopicId`. `onData` pre-arms `seededHistoryFor` with the new id so
  the just-enabled query cannot clobber the live stream.
- **Clipboard fallback (B9/R11)**: copy goes through
  `copyTextToClipboard` (`src/lib/clipboard.ts`) — `navigator.clipboard`
  is absent on insecure contexts (http over LAN), so it falls back to a
  hidden textarea + `execCommand("copy")`; only a double failure shows the
  failed state. Never call `navigator.clipboard` directly from components.
- Reseed rule: while streaming, `seededHistoryFor` stays set so a refetch
  cannot overwrite live frames. Teardown (in `finally`, after the stream
  fully ends) clears `seededHistoryFor` and invalidates
  `chatKeys.history(topicId)`; the existing seed effect then replaces
  local state with the persisted selected-version view.
- Version switch, delete, and delete-and-regenerate are server-confirmed
  mutations followed by the same reseed — no optimistic version swaps.
- Delete-and-regenerate is assistant-only (user menus omit it); it is a
  client composition of DELETE then regenerate, and a failed regenerate
  never rolls back the delete.
- `inFlight` covers both the chat stream and a regen stream so the
  composer locks during either.

### 5. Validation & Error Matrix

- Foreign/unknown message id on any of the three endpoints → `NOT_FOUND`.
- Client races the `onEnd` persistence of a just-streamed reply →
  `resolveServerMessageId` returns null after one retry → retryable
  "still being saved" error + reseed; the server 404 path stays untouched.
- Regenerate POST before the stream id arrives + user hits stop →
  `regenStopRequestedRef` stops the stream as soon as the id lands.
- Empty group → `AppError(INTERNAL)` from `selectedRowOf` (should be
  unreachable; deleting the last version removes the row, not the group).
- Regenerate with an unavailable model → `VALIDATION_FAILED` before any
  row is written (same check as `/api/chat`).
- Two consecutive user messages (answer deleted): regenerating the
  earlier one creates a **new** slot rather than hijacking the next
  user message's answer — the "immediately following" rule.

### 6. Tests Required

- Service unit (`message.service.test.ts`): single-version equivalence,
  grouping + version metadata, fallback selection, `groupId = id` inserts.
- Integration (`message.service.integration.test.ts`): delete with
  reselection incl. middle version, empty-group delete, select
  persistence, all four `resolveRegenerateTarget` branches,
  selected-only history, foreign-id `NOT_FOUND`.
- Component (`MessageActions.test.tsx` / `MessageItem.test.tsx`):
  switcher inside the reveal group, boundary disabling, per-role
  menu contents (user menu has no delete-and-regenerate), copy check-icon
  feedback + execCommand fallback paths, menu-open keep-alive.
- `MessageList.test.tsx`: groupId keying survives version switch;
  single-active reveal semantics (tap A → revealed, tap A again → still
  revealed, tap B → A hides); user messages share the slot.
- `ChatView.test.tsx`: session-created topic enables the history query for
  the real id; mid-session fetch cannot clobber the live stream; switcher
  appears after a message action without refresh (B8).
- `sync-message.test.ts` / `regenerate-stream.test.ts`: persistence-race
  guard (user-role skip, retry, give-up), placeholder insert/remove/fold.
- `clipboard.test.ts`: clipboard success, missing/reject fallback,
  double failure.
