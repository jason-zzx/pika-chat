# Chat Message Versions

> Cross-layer contract for regenerating assistant answers as switchable,
> persisted versions, for editing user messages into new versions, and for
> single-message deletion. Landed with
> `09-04-chat-message-regenerate-delete`; user-message editing landed with
> `10-19-edit-user-message-regenerate`. Complements
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
- `chat_messages.group_created_at` (timestamptz, NOT NULL, default
  `now()`): the group's **stable position anchor**, set at group creation
  and inherited by every later version (version inserts read it from a
  sibling row inside the deselect+insert transaction). Group display
  position = `groupCreatedAt`, never a version's own `createdAt` —
  deleting a group's earliest version must not move the group (before the
  anchor existed, position was the earliest *remaining* version's
  `createdAt`, so deleting it shifted the group and broke regenerate
  target resolution). Regenerating never reorders the conversation.

### 3. Contracts

- `listTopicMessages` returns the **selected-version view**: one message
  per group, ordered by group position. `/api/chat` history building, the
  history HTTP API, and the frontend seed all consume this one function,
  so "only the selected version enters model context" holds everywhere by
  construction. Never bypass it with a raw row query for context.
- Selection fallback: if a group has no `is_selected` row (legacy or
  partial writes), the latest version wins (`selectedRowOf`).
- Version metadata (`groupId`, `versionIndex`, `versionCount`,
  `versionIds`) rides in `chatMetadataSchema` — all optional, and emitted
  for **both roles** (`rowToChatUIMessage` applies it to any group with
  version info). User messages start as single-version groups and gain
  versions through editing (below); assistant messages gain them through
  regeneration. Single-version groups still carry the metadata
  (`versionCount: 1`). Live-streamed messages omit it; the view converges
  on reseed.
- `resolveRegenerateTarget({ topicId, messageId })`:
  - assistant message → its group; history = selected messages in groups
    before it.
  - user message → the *immediately following* assistant group if one
    exists, else a new answer slot; history = selected messages up to and
    including that user message.
  - `target` carries the clicked message's own `groupCreatedAt`; when
    `targetGroupId` is null (the slot was deleted empty), the route passes
    it as `groupCreatedAt` to `appendAssistantMessage` so the new group
    lands back at the slot's position instead of sorting to the topic's
    end. Same pass-through for the image-generation bypass.
  - Regenerating or deleting never truncates later messages (product
    decision D1).
- `deleteMessage` removes exactly one row. Deleting the selected version
  re-selects the newest remaining version in the same transaction;
  deleting the last version removes the slot. The group's
  `group_created_at` anchor lives on every row, so the surviving rows
  keep the group's position no matter which versions are deleted. The
  topic survives an empty conversation.
- Endpoints (all topic-scoped, ownership via `requireOwnedTopic` +
  `topicId` in every WHERE; foreign id → `NOT_FOUND`):
  - `DELETE /api/topics/[id]/messages/[messageId]` → 204
  - `POST .../select` → 204
  - `POST .../regenerate` → UI message stream; mirrors the `/api/chat`
    skeleton (availability check → `createChatModelHandle` →
    `registerStream` → `streamText` → `createUIMessageStream` → `onEnd`
    persists with `groupId`). **No** topic creation or title trigger.
    Stopped/failed outcomes persist as versions too. Optional `edit`
    payload (`chatRequestMessageSchema`) turns it into an
    edit-and-regenerate (below); without `edit` no user-message row is
    written.
- **Edit-and-regenerate** (user messages only): the regenerate request
  body may carry `edit: { id, parts }` — the edited content of the target
  user message. Contract and ordering, all before any DB write:
  model availability check → `resolveRegenerateTarget` (includes the
  compressed-zone assertion) → target must be a user row (else
  `VALIDATION_FAILED` `message.editTargetNotUser`) →
  `resolveOwnedFileParts` on the edit's file parts (ownership +
  canonicalization, same rule as `/api/chat`) →
  `appendUserMessageVersion` persists the edit (transaction: deselect
  siblings, then insert the new selected row into the same `group_id`;
  `createdAt` comes from the app clock, single-clock rule) →
  `resolveRegenerateTarget` re-runs on the new id so the history carries
  the edited version → the ordinary regenerate flow streams a new
  assistant version into the following answer group (or a fresh slot).
  The edit is persisted before streaming and is **never rolled back**: a
  failed stream lands a failed assistant version, same as plain
  regeneration.
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
- **Edit flow** (`UserMessageEditor` + `ChatView.handleEditSubmit`):
  user messages get an edit entry (pencil icon, leftmost action + first
  dropdown item) when the turn is actionable (not compressed-locked, not
  inFlight). The editor edits text and attachments in place (attachments
  reuse `useComposerAttachments` with a per-group `edit:<groupId>` staging
  bucket, cleared on exit — cancel performs zero writes). Submit mints a
  client-side id, optimistically swaps the user message with computed
  version metadata, drops the regen placeholder into the following answer
  slot, and POSTs regenerate with `edit` (path id = the clicked row's id;
  same group, so old/new ids are equivalent targets). A pre-stream failure
  restores the original version and placeholder-free list plus a localized
  error; a mid-stream failure keeps the edit (server already persisted
  it) and the teardown reseed converges the view.
- Version switch, delete, and delete-and-regenerate are server-confirmed
  mutations followed by the same reseed — no optimistic version swaps.
  Delete removes the row locally **only when the deleted version was the
  group's last one** (`versionIds` has no other id); when versions
  remain, the row stays mounted (keyed by `groupId`) showing the deleted
  version until the reseed swaps in the server's fallback selection —
  removing it first blanked the row for a full history round-trip, and a
  reseed hiccup left the group looking fully deleted.
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
- Regenerate with an `edit` payload on a non-user target →
  `VALIDATION_FAILED` `message.editTargetNotUser`, nothing written.
- `edit` with a foreign/forged file id → `resolveOwnedFileParts` 4xx
  before any write; the target group keeps its prior selected version.
- `edit` on a target in the compressed zone → the same `CONFLICT` 409 as
  plain regenerate (asserted inside `resolveRegenerateTarget`, before the
  edit branch writes anything).
- Edit stream fails after the edit persisted → the edited user version
  stays selected; the assistant side follows ordinary failed-turn
  semantics (a persisted failed version). Never roll back the edit.

### 6. Tests Required

- Service unit (`message.service.test.ts`): single-version equivalence,
  grouping + version metadata, fallback selection, `groupId = id` inserts.
- Integration (`message.service.integration.test.ts`): delete with
  reselection incl. middle version, empty-group delete, select
  persistence, all four `resolveRegenerateTarget` branches,
  selected-only history, foreign-id `NOT_FOUND`, group-anchor stability
  (deleting the earliest version keeps the group's position and the
  resolve still finds the following group, a detached regenerate lands
  back at the slot's position, user-message versions inherit the anchor).
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
- Edit-and-regenerate: `appendUserMessageVersion` (transactional
  deselect+insert, user-role enforcement, group position unchanged);
  route-level edit cases (history carries the edited version, non-user
  target 400, forged file id 4xx with zero writes, compressed-zone 409);
  `rowToChatUIMessage` emits version metadata for user rows. Component:
  edit entry is user-only and leftmost, editor prefill/cancel/zero-write,
  send disabled on empty content, attachment chips add/remove;
  `ChatView` edit submit (optimistic swap + placeholder + stream fold +
  pre-stream failure rollback).
- `clipboard.test.ts`: clipboard success, missing/reject fallback,
  double failure.
