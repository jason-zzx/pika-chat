# Chat Message Quote

> Quote selected message text into the next user turn — landed with
> `11-19-message-quote`. Cross-layer: a `data-quote` UI part travels from the
> composer through the request schema, persistence, and model replay, and the
> client resolves it back to the exact source text.

## Scenario: quoting part of a message into a user turn

### 1. Scope / Trigger

Any change to the `data-quote` part, the quotable-body marker, the composer /
editor quote card, or quote replay to the model. The part is a cross-layer
contract (request schema → stored parts → `convertToModelMessages`), so every
layer that filters user parts by `type` must keep it.

### 2. Signatures

```ts
// src/lib/schemas/chat.ts
type ChatQuote = { messageKey: string; text: string; offset: number };
ChatDataParts.quote: ChatQuote            // UI part type "data-quote"
chatRequestPartSchema / chatStoredPartSchema  // both accept { type: "data-quote", data: ChatQuote }

// src/components/chat/quote-range.ts
quoteFromSelection(selection: Selection, root: Element): ChatQuote | null
findQuoteRanges(article: Element, quote: ChatQuote): Range[] | null

// src/components/chat/MessageList.tsx
MessageListHandle.scrollToQuote(quote: ChatQuote): boolean  // false → caller falls back to flashMessage

// src/stores/composer-store.ts (session-only, per draftKey)
quotes: Record<string, ChatQuote | null>; setQuote(key, quote | null)

// src/server/ai/model-messages.ts
replayModelMessages → convertToModelMessages<ChatUIMessage>(…, { convertDataPart })
```

No DB column: the quote lives in the user message row's `parts` jsonb.

### 3. Contracts

- `messageKey` is the source row's version-group key (`groupId ?? id`, the
  same `data-message-key` the list renders). `text` is the trimmed
  `Selection.toString()`. `offset` is the start index within the
  concatenation of **all** `[data-quote-body]` text nodes of the source
  message, in document order.
- Quotable body = elements carrying `data-quote-body`: assistant markdown
  text blocks and the user bubble. Reasoning, tool calls, translations,
  timestamps, and action bars never carry it. A selection qualifies only if
  both ends sit in the same body element.
- Part order on a user message (client send, editor submit, and both server
  persist paths): **files → quote → text**. The text part is omitted when
  empty.
- Model replay: `convertDataPart` maps `data-quote` to a text part
  `<quote>\n{text}\n</quote>` (placed before the user's text by part order);
  every other data part maps to `undefined` (dropped). Compression's
  transcript renders it as `[Quoting: {text}]`.
- One quote per draft; quoting again replaces it. The composer quote is
  cleared on send; the editor seeds the shown version's quote and can only
  remove it.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| request message has 2+ `data-quote` parts | 400 (`chatRequestMessageSchema` refine) |
| request message is only a `data-quote` part | 400 (same refine); client `canSend` also ignores the quote |
| `data-quote` with empty `messageKey`/`text` or negative/non-int `offset` | 400 (`chatQuoteSchema`) |
| source text found at `offset` (whitespace-insensitive) | highlight that occurrence |
| not at `offset`, found by search | highlight first occurrence |
| not found (edited, version switched) | `scrollToQuote` → false → whole-message `flashMessage` |
| source message gone | `flashMessage` no-op |

### 5. Good/Base/Bad Cases

- Good: quote the second "foo" of "foo bar foo" → jump highlights the second.
- Base: quote spanning two paragraphs of one markdown block → one rect per
  line fragment, gap between paragraphs unhighlighted.
- Bad: selection from an assistant text block into the following tool-call
  block or next message → no Quote button.

### 6. Tests Required

- `chat.test.ts`: one quote + text/files accepted; quote-only and two quotes
  rejected.
- `model-messages.test.ts`: quote becomes a `<quote>` text part ahead of the
  user's text.
- `quote-range.test.ts`: selection → `{ messageKey, text, offset }`;
  repeated text resolves by offset; search fallback; no match → null.
- `composer-store.test.ts`: `setQuote` replaces, `null` removes.
- `ChatView.test.tsx` / `MessageItem.test.tsx`: send emits files → quote →
  text parts; sent card jumps; editor removal drops the part.

### 7. Wrong vs Correct

#### Wrong

```ts
// Filtering user parts by an allow-list that predates the quote silently
// drops it on persist or edit.
const parts = message.parts.filter((p) => p.type === "text" || p.type === "file");
```

#### Correct

```ts
const parts = message.parts.filter(
  (p) => p.type === "text" || p.type === "file" || p.type === "data-quote",
);
```

### Design Decision: card, data part, overlay highlight

- **Card, not inline token**: a native `<textarea>` cannot hold an atomic
  inline element; an inline token needs a contentEditable rewrite of the
  composer. Quote position inside the text carries no meaning, so a card
  above the textarea suffices.
- **Data part, not text prefix**: keeps the user's text as typed (search,
  edit, copy) while `convertDataPart` still gives the model the quote.
- **Overlay rects, not CSS Custom Highlight API**: `::highlight()` cannot
  transition, so it cannot fade. Rects come from per-text-node Ranges —
  `Range.getClientRects()` on one spanning Range also returns border boxes of
  fully contained elements, which would paint whole blocks.
