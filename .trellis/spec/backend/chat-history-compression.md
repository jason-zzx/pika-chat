# Chat History Compression

> Rolling-summary context management for long topics — landed with
> `09-16-history-compression`. The topic keeps a summary of its early turns
> plus a boundary message id; the model sees the summary instead of those
> messages. Original messages are never modified or deleted.

## Scenario: compressing history to fit the model context window

### 1. Scope / Trigger

Any change to how long conversations are trimmed before a model call, or to
the summary/boundary columns. Trigger conditions: adding another streaming
route that replays history, changing the compression threshold, adding a
summary provider/model setting, or surfacing compressed history in the UI.

Two routes replay history and **both** must apply the same trimming:
`POST /api/chat` and the regenerate route
(`/api/topics/[id]/messages/[messageId]/regenerate`). A route that replays the
full history re-introduces the overflow this feature exists to prevent.

### 2. Signatures

`src/server/services/compression.service.ts`:

```ts
export const HISTORY_COMPRESSION_RATIO = 0.8;
export const FILE_PART_TOKEN_ALLOWANCE = 1000;

estimateMessagesTokens(messages: ChatUIMessage[]): number
exceedsCompressionThreshold(messages: ChatUIMessage[], contextTokens: number): boolean
/** Boundary identity: the persisted row id PLUS its version group. Matching
 * happens on the group — see the boundary contract below. */
type CompressionBoundary = { id: string; groupId: string | null }
messagesAfterBoundary(messages: ChatUIMessage[], boundary: CompressionBoundary | null): ChatUIMessage[]
boundaryFromSummaryState(state: TopicSummaryState | null): CompressionBoundary | null
getTopicSummaryState(topicId: string, actor: Actor): Promise<TopicSummaryState | null>
transcriptForSummary(messages: ChatUIMessage[]): string
compressTopicHistory(
  input: { topicId: string; handle: ChatModelHandle },
  actor: Actor,
): Promise<CompressionResult>  // carries summaryText, summaryUpToMessageId, summaryUpToGroupId, compressedCount
```

`buildChatInstructions({ …, historySummary })` —
`src/server/ai/instructions.ts` (the only instructions entry point, see
[chat-message-metadata.md](./chat-message-metadata.md) and rule #109).
Sections, in order: assistant system prompt → current date → history summary →
search guidance + citation directive.

DB columns on `topics` (all nullable — old topics behave exactly as before):
`summary_text text`, `summary_up_to_message_id text`. `topicColumns` in
`src/server/db/schema/assistant.ts` is the shared `Topic` projection — the new
columns are **not** in it; `findTopicDetailForActor` and
`getTopicSummaryState` select them explicitly. There is deliberately no
`summary_updated_at`: nothing reads a compression timestamp, and a column that
is only ever written is a lie waiting to be trusted (migration
`0022_aberrant_mercury`).

Model resolution for the summary call goes through
`requireModelForActor({ providerConfigId, modelId }, actor)`
(`src/server/ai/require-model.ts`) — the single owner of the

```
resolveAvailableModels → find → throw model.notAvailable → createChatModelHandle
```

sequence shared by `/api/chat`, the regenerate route, and
`POST /api/topics/[id]/compress`. It returns `{ selected, handle }` because the
streaming routes also need `contextTokens` / `inputModalities` from the matched
catalog entry. Never re-inline that gate: three copies is how one of them ends
up skipping the availability check.

Endpoints: `POST /api/topics/[id]/compress` (manual) →
`{ summaryUpToMessageId, summaryUpToGroupId, compressedCount }`;
`GET /api/topics/[id]` exposes `summaryUpToMessageId`, `summaryUpToGroupId`, and
`summaryText` (the divider's collapsible body).

### 3. Contracts

- **Threshold**: auto-compression fires when
  `estimateMessagesTokens([...modelHistory, userMessage]) >
  contextTokens * 0.8`. `estimateMessagesTokens` is chars/2 for text,
  1000 per file part, and serialized size/2 for tool parts. It overestimates
  English on purpose: compressing early is safe, overflowing is not. There is
  no tokenizer dependency.
- **Boundary is inclusive and matched by version GROUP**: `summaryUpToGroupId`
  is the boundary message's `group_id`, and `messagesAfterBoundary` slices
  strictly after the message whose `metadata.groupId ?? id` equals it
  (`groupId ?? id` as the key; falls back to raw-id matching for rows written
  before the group was exposed). This matters because the persisted id is the
  *row that happened to be selected at compression time*: switching the
  boundary group's version used to make the id unresolvable and revert to the
  full history, duplicating the summary with the text it already covers. Both
  consumers of the boundary — trimming and the compressed-zone lock in
  `message.service.ts` (`assertTargetNotCompressed`) — use group semantics, and
  both treat an unresolvable boundary the same way (no lock / full history;
  over-sending beats silently dropping turns). The client's
  `matchesCompressionBoundary` in `MessageList` applies the same rule, so the
  divider, the lock, and the model payload cannot disagree.
- **Failure is non-fatal on the auto path, and never discards a summary**: the
  route computes `historySummary`/`modelHistory` from the PERSISTED summary
  state first and only attempts a re-compression when unsummarized messages
  exist (`modelHistory.length > 0`). A failure is logged (`errorName` only, no
  content) and the turn proceeds with that already-correct
  summary + post-boundary history. Only a topic that was never compressed
  falls back to the full history with no summary (AC6). The manual endpoint
  surfaces the error.
- **Rolling update**: each run merges the not-yet-summarized selected-version
  messages into the previous summary (prompt carries
  `<previous-summary>` + `<new-messages>`) and replaces `summary_text`
  wholesale. The boundary only ever moves forward.
- **Selected versions only**: the summary input comes from
  `listTopicMessages`, which returns `is_selected` rows — the same set the
  model would have seen. Never read raw `chat_messages` rows for the summary.
- **Attachments**: `transcriptForSummary` emits text parts plus
  `[Attachment: <filename>]` markers. Multimodal payloads are never sent to
  the summary model.
- **Failure is non-fatal on the auto path, and never discards a summary**: the
  route computes `historySummary`/`modelHistory` from the PERSISTED summary
  state first and only attempts a re-compression when unsummarized messages
  exist (`modelHistory.length > 0`). A failure is logged (`errorName` only, no
  content) and the turn proceeds with that already-correct
  summary + post-boundary history. Only a topic that was never compressed
  falls back to the full history with no summary (AC6). The manual endpoint
  surfaces the error.
- **Original messages untouched**: compression writes only the `topics` row
  (PRD R4/AC5).
- **Compressed zone is read-mostly**: messages up to and including the boundary
  group reject `deleteMessage` and `resolveRegenerateTarget` with
  `CONFLICT` 409 `message.compressedLocked` (the summary covers them, so
  removing or regenerating them would invalidate it). Version switching inside
  the zone stays allowed — it changes which text the summary covers, which the
  group-based boundary above absorbs without falling back to the full history.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Topic unknown or not owned | `NOT_FOUND` 404 `topic.notFound` |
| No unsummarized history (or empty transcript) | `VALIDATION_FAILED` 400 `topic.nothingToCompress` |
| Model rejected by `resolveAvailableModels` | `VALIDATION_FAILED` 400 `model.notAvailable` (before any work) |
| Summary model returns empty text | `PROVIDER_ERROR` 502 `provider.unexpectedResponse`; nothing persisted |
| Summary call fails/times out (30s) on the auto path | logged; the turn keeps the persisted summary + post-boundary history (full history only when none was ever persisted) |
| Target message is inside the compressed zone | `CONFLICT` 409 `message.compressedLocked` (delete + regenerate) |
| Topic never compressed | `getTopicSummaryState` → `null`; full history, no summary section |

### 5. Good / Base / Bad Cases

- Good: long topic → threshold crossed → summary generated and persisted → the
  same turn's model payload is `summary + post-boundary messages`; reload shows
  the divider after the boundary message.
- Base: fresh topic → no summary columns → identical behavior to before the
  feature; a second send below the threshold reuses the persisted summary
  without calling the summary model again.
- Bad: trimming the message list passed as `originalMessages` (the stream
  reconcile set) instead of only the model payload — the client's stream
  reconciliation then disagrees with the transcript. Only `modelHistory` is
  trimmed; `originalMessages` keeps the complete history.

### 6. Tests Required

- `compression.service.test.ts`: estimator (text/file/tool parts), threshold
  boundary, `messagesAfterBoundary` incl. missing-boundary fallback, transcript
  formatting.
- `compression.service.integration.test.ts`: persist + rolling update (previous
  summary present, boundary advances, `compressedCount` counts only new
  messages), messages byte-identical after compression, ownership 404 (compress
  AND detail reads), 400 nothing-to-compress, provider failure persists
  nothing, manual endpoint end-to-end, `GET /api/topics/[id]` exposes
  `summaryUpToGroupId` + `summaryText`, switching the boundary group's selected
  version keeps the clip post-boundary and the lock at 409.
- `src/app/api/chat/route.test.ts`: over threshold → instructions contain the
  summary and the model payload only carries post-boundary messages; failed
  re-compression → persisted summary kept with post-boundary history (full
  history only when never compressed); nothing-new-to-compress → compression
  not attempted, summary kept; below threshold → persisted summary reused with
  no further model call.
- regenerate `route.test.ts`: compressed topic → summary + post-boundary
  history; uncompressed topic → unchanged behavior.
- Component tests for the affordances: `Composer` compress button (enabled +
  `onCompress`, disabled when `compressDisabled` — including an empty topic,
  where the server would only 400), `MessageList` divider rendered after the
  boundary message and absent when unmatched (including the group-match case
  where the boundary id belongs to a sibling version), the collapsible summary
  panel (collapsed by default, toggles, non-interactive when no summary is
  persisted), the compressed-zone lock (pre-boundary messages lose the delete
  and regenerate entries, post-boundary ones keep them), and the in-flight
  shimmer (`compressingHistory`) rendered at the end of the list with
  `role="status"` and removed once the request settles. `ChatView` covers the
  chain: click → shimmer → invalidation → real marker replaces it (`getTopic`
  mocked to report the new boundary), and the failure path (shimmer cleared +
  localized `Errors.actions.compress`).

### 7. Wrong vs Correct

#### Wrong

```ts
// Replaying the full history on a second streaming route, or trimming the
// reconcile set — the client then disagrees with the transcript.
const modelMessages = await replayModelMessages(routedMessages);
// ...
<UIMessageStream originalMessages={modelHistory} />

// Letting a summary failure abort the turn.
await compressTopicHistory({ topicId, handle }, actor);
```

#### Correct

```ts
// Both streaming routes: summary + post-boundary messages only. The boundary
// carries its group, so switching the boundary group's version cannot make it
// unresolvable (see the boundary contract above).
const summaryState = await getTopicSummaryState(topicId, actor);
const boundary = boundaryFromSummaryState(summaryState);
let historySummary = summaryState?.summaryText ?? null;
let modelHistory = messagesAfterBoundary(history, boundary);
const modelMessages = await replayModelMessages(
  await resolveAttachmentsForModel([...modelHistory, userMessage], { … }),
);
// originalMessages stays the COMPLETE history.
<UIMessageStream originalMessages={routedMessages} />

// Only re-compress when there is something new to fold in, and never discard
// the persisted summary on failure (AC6).
if (modelHistory.length > 0 && exceedsCompressionThreshold([...modelHistory, userMessage], selected.contextTokens)) {
  try {
    const compressed = await compressTopicHistory({ topicId, handle }, actor);
    historySummary = compressed.summaryText;
    modelHistory = messagesAfterBoundary(history, boundaryFromSummaryState({
      summaryUpToMessageId: compressed.summaryUpToMessageId,
      summaryUpToGroupId: compressed.summaryUpToGroupId,
    }));
  } catch (caught) {
    logger.warn({ topicId, errorName: … }, "history compression failed; keeping the persisted summary");
    // historySummary / modelHistory keep their pre-compression values.
  }
}
```

### Known limitation

Compression runs on the `/api/chat` and regenerate paths. Any future route that
replays history must call the same pair
(`getTopicSummaryState` → `messagesAfterBoundary` → `historySummary`), or it
will silently send the untrimmed history.

Auto-compression is server-side and has no client state, so it shows no
in-flight indicator; only the manual (Composer) path has one. A boundary row
that is actually deleted (not merely version-switched) still falls back to the
full history and unlocks on both sides — the accepted over-send direction.
