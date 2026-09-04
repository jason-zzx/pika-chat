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
  **per role**: user rows get `{ createdAt }` only, assistant rows get the
  full set. `appendAssistantMessage` takes persistable fields (e.g.
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
// Per-role metadata; both roles carry createdAt.
if (row.role !== "assistant") {
  return { createdAt: row.createdAt.toISOString() };
}

// Early emit once from the execute closure, driven by onChunk observations;
// finish metadata still carries the value as the authoritative fallback.
writer.write({ type: "message-metadata", messageMetadata: { reasoningMs } });
```
