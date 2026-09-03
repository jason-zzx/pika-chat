# Design — Chat page message meta info optimization

## 1. Current state (verified)

- Topic title: `src/components/layout/InsetHeader.tsx:14` renders `text-lg font-semibold tracking-tight`.
- Per-message rendering: `MessageItem.tsx` renders one `<article>` per message (`items-end` for user, `items-start` for assistant); no name/avatar/model/timestamp/actions today.
- Assistant identity lives in `ChatView.tsx` (`resolvedAssistant` → `name`, `icon`; defaults `DEFAULT_ASSISTANT_NAME`/`DEFAULT_ASSISTANT_ICON` in `src/lib/schemas/assistant.ts`) but is not passed to `MessageList`/`MessageItem`.
- Model id is already stored per assistant message (`chatMessages.modelId`, exposed as `message.metadata.modelId`) but never displayed.
- DB stores `chatMessages.createdAt` (timestamptz, notNull) but `rowToChatUIMessage()` in `src/server/services/message.service.ts` drops it; `chatUIMessageSchema` has no timestamp field.
- Reasoning stream timing is not captured anywhere; `ReasoningBlock` toggle text is `Thinking`/`Thought` (`ReasoningBlock.tsx:70`).
- No copy-to-clipboard exists in `src/`; icon library is lucide-react (`*Icon` exports).

## 2. Data model changes

### 2.1 Shared schema (`src/lib/schemas/chat.ts`)

Extend `chatMetadataSchema` (optional fields only — backward compatible with old rows and old streams):

```ts
createdAt: z.string().optional(),              // ISO 8601, message creation time
reasoningMs: z.number().int().nonnegative().optional(), // reasoning phase duration
```

`createdAt` sits on metadata (not message-level) because `ChatUIMessage` metadata is already optional and present for both roles; user messages simply get a metadata object containing only `createdAt`. `metadataFromRow` must therefore stop returning `undefined` for user rows and return `{ createdAt }` instead.

### 2.2 DB schema (`src/server/db/schema/chat.ts`) + migration

Add one nullable column to `chatMessages`:

```ts
reasoningMs: integer("reasoning_ms"),  // nullable
```

Generate/apply with `pnpm db:generate` + `pnpm db:migrate`. No backfill: legacy rows have no duration (UI hides it). `createdAt` needs no column — it already exists.

## 3. Server flow (timestamps + reasoning duration)

### 3.1 Persistence (`message.service.ts`)

- `metadataFromRow`:
  - user rows → `{ createdAt: row.createdAt.toISOString() }`
  - assistant rows → existing fields + `createdAt` + `reasoningMs: row.reasoningMs ?? undefined`
- `appendAssistantMessage` input gains `reasoningMs?: number | null` and writes it to the new column.

### 3.2 Chat route (`src/app/api/chat/route.ts`)

Reasoning timing is captured server-side (single clock, survives reloads, no client guesswork):

- A small helper `createReasoningTimer()` in `src/server/ai/reasoning-timer.ts` consumes `streamText` `onChunk` events:
  - first `reasoning-start` (fallback: first `reasoning-delta`) → `startedAt = Date.now()`
  - `reasoning-end` or first `text-start`/`text-delta` after start → `endedAt = Date.now()`
  - `measure()` returns `Math.round(endedAt - startedAt)` or `undefined` when reasoning never started/ended; on `finish` with `startedAt` but no `endedAt` (aborted mid-thought), treat finish time as end so stopped streams still get a duration.
- Route wiring:
  - `onChunk` feeds the timer.
  - When the timer first yields a value **and the answer is starting**, write it early so the label updates before the whole stream ends: the `execute({ writer })` closure registers a callback the `onChunk` handler invokes → `writer.write({ type: "message-metadata", messageMetadata: { reasoningMs } })` (chunk type exists in `ai` v7; `useChat` merges it into the live assistant message). Keep the value also in the finish `messageMetadata` as a fallback so late-joining metadata always carries it.
  - Pass `reasoningMs` into `appendAssistantMessage` for persistence.
- User message timestamps: nothing to do server-side — `createdAt` already defaults to `now()` on insert and `metadataFromRow` now exposes it.

### 3.3 Live (non-reloaded) messages

- User: `ChatView.handleSend` stamps it optimistically via `sendMessage({ text, metadata: { createdAt: new Date().toISOString() } })` (`sendMessage` accepts `CreateUIMessage`, which carries `metadata` — verified in `ai@7.0.85` types). The server persists its own `defaultNow()` value; the tiny skew (request latency) is acceptable and disappears on reload.
- Assistant: metadata (including `createdAt`) arrives from the server stream. The finish metadata emits `createdAt` = the server-captured stream-start time (captured before `streamText`), so live messages match what a reload will show. Note: `messageMetadata` is only called on `start`/`finish`; with `sendStart: false` the value effectively lands at finish — acceptable, the timestamp is only visible on hover anyway. History reload will always agree with the persisted row.

## 4. Frontend design

### 4.1 Prop threading

- `ChatView` → `MessageList` → `MessageItem`: new prop `assistantName?: string`, `assistantIcon?: string` (from `resolvedAssistant`; `MessageItem` applies the defaults from `@/lib/schemas/assistant`).
- `MessageItem` gains `reasoningMs` passthrough to `ReasoningBlock` (read from `message.metadata.reasoningMs`).

### 4.2 `MessageItem` structure (assistant branch)

```
<article class="group/message flex flex-col gap-1 items-start">   ← group/message for hover-reveal
  [header row]  ✨ Assistant   <time>            (R2 + R5, left; time right of name)
  [ReasoningBlock]  "Thought (3.2s)"             (R6)
  [body w-full]  Streamdown / placeholder
  [status captions]  Stopped / failed / length   (unchanged, above model row)
  [model row]   gpt-5.2                          (R3, text-xs text-muted-foreground)
  [actions row]  ⧉ copy                           (R4, left)
</article>
```

User branch:

```
<article class="group/message flex flex-col gap-1 items-end">
  [time row]  <time>                              (R5, above bubble, right)
  [bubble]
  [actions row]  ⧉ copy                           (R4, right)
</article>
```

### 4.3 Hover-reveal pattern (space reserved, no layout shift)

All reveal-on-hover rows render unconditionally with a fixed height and fade via opacity:

```
h-5 shrink-0 opacity-0 transition-opacity duration-150 motion-reduce:transition-none
group-hover/message:opacity-100 group-focus-within/message:opacity-100
```

(`group/message` avoids collisions with other `group` usages; `group-focus-within` keeps keyboard users able to reach and see the copy button per the frontend a11y spec.)

### 4.4 New components (`src/components/chat/`)

- `MessageTimestamp.tsx` — renders `<time dateTime={iso} title={exact(iso)}>` with the human label. Pure formatting lives in `src/lib/message-time.ts` (unit-testable):
  - `formatMessageAge(iso, now)` → `just now` | `N minutes ago` | `N hours ago` | `Sep 3` | `Sep 3, 2025` (uses `Intl.DateTimeFormat`, month-short day-numeric; adds year when the message year ≠ current year).
  - `formatMessageExact(iso)` → `yyyy-MM-dd HH:mm:ss` (local time, zero-padded) for the `title` tooltip.
  - Returns `undefined` for missing/invalid input so callers can skip rendering.
  - Freshness: the component re-renders on a 30s interval (single `setInterval` per mounted timestamp, cleared on unmount); intervals are cheap and only tick while the conversation is mounted.
- `MessageActions.tsx` — currently one button: copy. Props: `text: string`. Uses `navigator.clipboard.writeText`; on success swaps `CopyIcon` → `CheckIcon` for ~2s (`aria-label="Copy message"`, success state announces via `title`/`aria-live` polite text swap). On failure (clipboard rejected/unavailable), shows a transient `Copy failed` title; never throws into the stream UI. Button is a plain `<button>` styled like existing ghost icon buttons (`text-muted-foreground hover:text-foreground`).

### 4.5 `ReasoningBlock`

New optional prop `reasoningMs?: number`. Toggle text becomes:

- streaming → `Thinking` (no duration — thinking not finished)
- otherwise, `reasoningMs != null` → `Thought (X.Xs)` via `(reasoningMs / 1000).toFixed(1)`
- otherwise → `Thought`

The accessible name of the button changes accordingly (tests updated).

### 4.6 `InsetHeader`

`text-lg` → `text-base` on the `<h1>`. Nothing else changes.

## 5. Alternatives considered

- **Client-side reasoning timing** (watch parts transitions in `ChatView`): rejected — clock skew, lost on reload, duplicated state; server capture is one helper + one column.
- **Timestamp at message level instead of metadata**: rejected — `UIMessage` metadata is the established channel (stream metadata merges automatically) and keeps the stored schema a single zod object.
- **Persisting reasoning duration inside `parts` jsonb**: rejected — parts are a typed union validated per-item; a duration is message-level metadata, not a part.
- **Revealing action rows only when hovered (conditional mount)**: rejected — requirement explicitly reserves layout space to avoid hover layout shift.

## 6. Risks / edge cases

- `writer.write({ type: "message-metadata", ... })` from the `onChunk` callback fires while the merged UI stream is open; this mirrors how `data-topic` is written from `execute` and is supported by `ai` v7 chunk handling. Fallback: the finish metadata always carries `reasoningMs`, so worst case the label appears at stream end instead of thought-end.
- Old rows / failed messages: no `createdAt` in metadata? — `createdAt` is notNull in DB, so every row has one; only `modelId`/`reasoningMs` are legitimately absent and the UI hides those rows.
- Multi-reasoning-block messages (agentic loops): the app has no tool loop today; timer measures the first reasoning cycle, matching the single `ReasoningBlock` rendering.
- Clipboard API in tests/jsdom: `MessageActions` tests mock `navigator.clipboard`.
- `Intl.DateTimeFormat` output is locale-dependent; tests pin the constructed format (`month: "short", day: "numeric"` etc.) via explicit locale `en-US` in the util to keep snapshots deterministic.
