# Chat Message Metadata Contract

> Cross-layer contract for per-message assistant/user metadata — landed with
> `09-04-chat-message-meta` (`createdAt`, `reasoningMs`); earlier fields:
> `providerConfigId`, `modelId`, `totalTokens`, `finishReason`, `outcome`,
> `errorMessage`.

## Scenario: adding or consuming a per-message metadata field

### 1. Scope / Trigger

Any new piece of per-message information (who, what model, when, usage,
outcome) that must (a) render in the chat UI, (b) survive reload, and
(c) appear on the live streamed message without waiting for a reload. Touches
zod schema, DB column, message service, chat route, and components — change
them together or the live and reloaded views disagree.

### 2. Signatures

- Schema: `chatMetadataSchema` in `src/lib/schemas/chat.ts` — every field
  `.optional()`; extend, never narrow existing fields. `ChatUIMessage =
  UIMessage<ChatMetadata, ChatDataParts>`.
- DB: nullable columns on `chatMessages` (`src/server/db/schema/chat.ts`) +
  drizzle migration (`pnpm db:generate` / `pnpm db:migrate`). `createdAt` is
  the exception: column already exists (`timestamptz notNull defaultNow()`).
- Service: `metadataFromRow(row)` rebuilds `ChatMetadata` from columns —
  **per role**: user rows get `{ createdAt, translations? }`, assistant rows
  get the full set. (`translations` is a per-version language→text map added
  for lazy translation — see
  [chat-message-translation.md](./chat-message-translation.md).) `appendAssistantMessage` takes persistable fields (e.g.
  `reasoningMs`, `createdAt?: Date`) and spreads them into `.values(...)`
  (`...(input.createdAt ? { createdAt: input.createdAt } : {})` so omitted
  fields fall back to column defaults).
- Live metadata: route `messageMetadata: ({ part }) => part.type === "finish"
  ? {...} : undefined` inside `toUIMessageStream` — it runs on `start` and
  `finish`; returning `undefined` for start keeps it effectively finish-only.
  `sendStart` is **true** on both streaming routes: the start chunk carries
  the server-generated message id the client needs for follow-up actions
  (regenerate/delete/select). Do not set `sendStart: false` — with it the
  client invents its own id and the server 404s on that id (B6).
- Persistence input: `appendAssistantMessage({ topicId, message, outcome,
  errorMessage, providerConfigId, modelId, reasoningMs, createdAt }, actor)`.

### 3. Contracts

- History response: `rowToChatUIMessage` → `metadata.createdAt` is the DB
  row's ISO string; unknown optional fields are simply absent.
- Live assistant message: finish `messageMetadata` carries the same fields;
  metadata objects with `undefined` values serialize away, so live and
  reloaded messages converge once keys match.
- Early emission (UI feedback before the stream ends): write a
  `message-metadata` chunk from the `createUIMessageStream` `execute({ writer
  })` closure — `writer.write({ type: "message-metadata", messageMetadata: {
  reasoningMs } })`; `useChat` merges it into the current assistant message.
  Wire it to a signal observed in `streamText`'s `onChunk`
  (`createReasoningTimer` + `emitReasoningMetadata?.()`), emit-once.
  Multi-step tool turns (R6): `createReasoningTimer` measures **every**
  reasoning phase (`durations(): number[]`, one entry per closed phase;
  `measure()` is the total and feeds the `reasoningMs` column/finish
  metadata). The early emit re-fires as each phase closes with the
  cumulative `reasoningDurations` list (track the emitted count instead of a
  once-flag), and the finish metadata carries the full list. An early
  `message-metadata` write **replaces the whole metadata object** client-side
  — every mid-stream emit must carry all currently-relevant fields, and any
  future mid-stream field must be included in every emit (the finish chunk
  always carries the full authoritative object). At `onEnd` the
  durations are zipped into the reasoning parts via `withReasoningDurations`
  (`durationMs` on the reasoning variant of `chatStoredPartSchema` — no new
  column); `metadataFromRow` derives `reasoningDurations` from the parts on
  history load so live and reloaded views converge.
- Optimistic user message: `sendMessage({ text, metadata: { createdAt: new
  Date().toISOString() } })` (`CreateUIMessage` carries metadata). The server
  persists its own `defaultNow()` value for the user row; sub-second skew vs
  the client stamp is accepted and disappears on reload. For assistant
  messages there is no skew: the route persists `createdAt: streamStartedAt`
  (captured before `streamText`), matching the finish metadata.
- Timestamps/durations are metadata, **not** message parts — never stuff them
  into `parts` (per-item zod union would need new variants).

### 4. Validation & Error Matrix

- Unknown metadata keys from old clients/rows → dropped by zod `.optional()`
  object parsing; never fail the message.
- `reasoningMs` only when reasoning started AND ended; streams stopped
  mid-thought may omit it (finish closes an open measurement first — see
  `reasoning-timer.ts`); no reasoning → `undefined`, UI hides the duration.
- `createdAt` on metadata is a string (ISO); UI formatters must return
  `undefined` for missing/invalid input instead of throwing.
- One bad part must not discard the message (`uiPartsFromJson` per-item
  parse); the same resilience applies to metadata consumers.

### 5. Good / Base / Bad Cases

- Good: new field → optional schema field + nullable column + `metadataFromRow`
  + finish metadata (+ early emit if the UI needs it mid-stream) + component
  reads with fallback → live and reloaded views identical.
- Base: legacy row without the column value → `undefined` metadata field → UI
  hides that row (`{modelId ? <p/> : null}` style).
- Bad: writing per-message state into a message part or client-only store;
  emitting metadata only from the finish callback when the label must update
  mid-stream (reasoning duration); returning `undefined` metadata for user
  rows when the UI needs their `createdAt`.

### 6. Tests Required

- Service (`message.service.test.ts`): insert shape for every persisted field
  (explicit value AND defaultNow fallback paths), `metadataFromRow` output per
  role, `rowToChatUIMessage` ISO string round-trip.
- Server helper unit tests (`reasoning-timer.test.ts`): start/end on the
  documented chunk types, answer-text close, finish fallback, no-reasoning →
  `undefined`, never negative/NaN.
- Component (`MessageItem.test.tsx`): rows appear/disappear with metadata,
  ordering of header/body/model/actions rows, accessible names (button names
  change when a duration renders — update, never delete).

### 7. Wrong vs Correct

#### Wrong

```ts
// User rows: metadata silently dropped, UI loses the timestamp.
if (row.role !== "assistant") return undefined;

// Mid-stream label update attempted from the finish-only callback.
messageMetadata: ({ part }) =>
  part.type === "finish" ? { reasoningMs } : undefined, // lands too late
```

#### Correct

```ts
// Per-role metadata; both roles carry createdAt (assistant rows also carry
translations, provider/model usage fields, etc.).
if (row.role !== "assistant") {
  return {
    createdAt: row.createdAt.toISOString(),
    ...(row.translations ? { translations: row.translations } : {}),
  };
}

// Early emit once from the execute closure, driven by onChunk observations;
// finish metadata still carries the value as the authoritative fallback.
writer.write({ type: "message-metadata", messageMetadata: { reasoningMs } });
```

## Scenario: a failed turn

### 1. Scope / Trigger

Any change to how a provider failure is recorded or shown. The failure reason
must be identical live, after a reload, and after a regenerate — the transcript
reads it back from the row, so the row is the only source of truth.

### 2. Signatures

- `outcome: "failed"` + `errorMessage` are written by the streaming routes'
  `onEnd` through `appendAssistantMessage`; the column is
  `chat_messages.error_message`, rebuilt by `metadataFromRow`.
- `errorMessage` holds the **upstream `error` field**, scrubbed and formatted
  (objects arrive as indented JSON). It is not our catalog copy unless the
  provider body was empty. See `src/server/ai/provider-error.ts`.
- `Chat.MessageItem` renders it through `ErrorBlock`, the shared error surface —
  monospace, height-capped, internally scrolling, `role="alert"`.

### 3. Contracts

- There is no finish `messageMetadata` for a failed turn: the stream errors
  fatally, so no finish part is emitted. That is why the failed case cannot
  reuse the reasoning-duration trick above.
- Live convergence therefore comes from **reseed**, not from stream metadata.
  The client stamps the failure locally (`outcome` **and** the error text — the
  stream carries the same sanitized string the server persists, so nothing
  renders the generic fallback in between), then clears the `seededHistoryFor`
  guard on the erroring `onFinish` so the refetch replaces it with the persisted
  row. The server persists in its own `onEnd`, which runs before the response
  stream closes, so the row is already there.
- Two failure kinds must stay distinguishable on the client, and
  `isApiErrorEnvelope` is the test: our JSON envelope means the request failed
  **before a stream opened** (no message to attach it to → the composer banner
  is its home), while plain text means the **stream failed** (the transcript
  owns it). Stamping envelope JSON onto a message would put raw wire data in the
  transcript; treating a stream failure as a banner would duplicate it.
- `useChat`'s `error` is a latch: nothing clears it but a new send or an
  explicit `clearError()`. A regenerate never touches `useChat`, so a failure
  left latched resurfaces later — the regenerate placeholder carries no
  `outcome`, which is enough to re-show the banner mid-request. Release the
  latch as soon as the failure is rendered in the transcript.
- Deciding the turn failed must not key on `outcome.status` — see
  [error-handling.md](./error-handling.md#do-not-trust-outcomestatus).

### 4. Validation & Error Matrix

- `outcome: "failed"` with no `errorMessage` → `MessageItem` falls back to the
  localized `failedFallback` caption. Reachable for legacy rows only; the
  routes always set the text when they set the outcome.
- Empty or missing provider body → a catalog key (`provider.requestFailed`,
  `provider.credentialsRejected`, …) instead of upstream text.
- Over-long payload → clamped at the boundary and scrolled in the container.

### 5. Tests Required

- Route (`/api/chat`, regenerate): a model that fails **after the stream has
  opened** must persist `outcome: "failed"` with a non-null `errorMessage`, and
  the response body must carry our text rather than the SDK's default.
  A happy-path-only test does not cover this.
- `provider-error`: whole-`error`-object extraction, key/auth/base-URL
  scrubbing, raw-body fallback, clamping.
- `ErrorBlock` / `MessageItem`: payload rendered whole, height capped.

### 6. Wrong vs Correct

The server half — never key a turn outcome on `outcome.status`, always pass
`onError` to `toUIMessageStream` — is owned by
[error-handling.md](./error-handling.md#do-not-trust-outcomestatus), and the
shared tracker is `src/server/ai/stream-failure.ts`. The client half, which only
this scenario covers:

- **Wrong**: stamp `outcome: "failed"` without the reason, so the transcript
  renders the generic fallback until the reseed lands. And leave the send error
  latched — nothing clears it but a new send, so a regenerate (which never
  touches `useChat`) makes it flash back as a composer banner.
- **Correct**: stamp the outcome *and* the stream's error text, which is the
  same string the server persisted, then release the latch once the transcript
  owns the failure.
