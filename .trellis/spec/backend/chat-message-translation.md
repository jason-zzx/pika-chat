# Chat Message Translation

> Per-message-version translation with a persistent cache — landed with
> `09-16-message-translation`. A translation is computed once per (message
> version, language) and read back on reload.

## Scenario: translating a message version on demand

### 1. Scope / Trigger

Any change to per-message translations: the `translations` column, the
`/api/translate` endpoint, or the language list. The contract exists so a
translation is computed once and read back on reload without a second model
call.

### 2. Signatures

```ts
// src/lib/translate/languages.ts (isomorphic, no server imports)
TRANSLATE_TARGET_LANGUAGES: readonly { code; nativeName }[]  // 8 entries
TRANSLATE_TARGET_LANGUAGE_CODES                               // zod enum tuple
translateLanguageNativeName(code: string): string

// src/lib/schemas/chat.ts
chatMetadataSchema.translations?: Record<string, string>   // key = BCP-47 code
translateMessageRequestSchema: { messageId, targetLang, providerConfigId, modelId }
translateMessageResponseSchema: { translation: string }

// src/server/services/translation.service.ts
buildTranslateInstructions(targetLang: TranslateTargetLanguageCode): string
translateMessage(input, actor): Promise<{ translation: string }>
```

DB: `chat_messages.translations jsonb` nullable — a language→text map on the
message **version row** (versions are independent, per
[chat-message-versions.md](./chat-message-versions.md)).

### 3. Contracts

- `POST /api/translate` is cache-first: an existing
  `translations[targetLang]` returns immediately and never calls the model.
- Persistence merges by key (`jsonb ||`) — translating a second language must
  not drop the first. Never replace the whole object.
- The client also pre-checks the cache (`ChatView.handleTranslate`) so a repeat
  tap costs no request; the server check is the authority.
- The translation model is one-shot `generateText` with the session's model
  (same pattern as title generation), not a chat turn — so it does **not**
  assemble instructions through `buildChatInstructions`. The prompt demands
  output-only translation, markdown/code-block preservation, and a verbatim
  return when the source is already in the target language.
- `listTopicMessages` → `metadataFromRow` exposes `translations` for **both**
  roles (see the metadata spec), so the block survives reload and locale
  switches of the UI chrome do not affect it.
- `listTopicMessages` is declared as returning `ChatHistoryData` (the parsed
  wire messages widened to `ChatUIMessage[]`, defined in
  `src/lib/schemas/chat.ts`) while still parsing
  `chatMessagesResponseSchema`. Widening **once, at the API boundary**, is what
  lets `ChatView.handleTranslate` map the new translation into both the live
  list and the query cache (`setQueryData<ChatHistoryData | undefined>`) with a
  single non-generic `mergeTranslation` helper and no `as` cast. Do not
  re-narrow the query type or re-inline the alias into a component module: the
  next cache writer then needs a cast, or `lib/` starts importing components.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Message unknown or not owned (message→topic→assistant→owner) | `NOT_FOUND` 404 `message.notFound` |
| Invalid `targetLang` | `VALIDATION_FAILED` 400 (zod enum over the 8 codes) |
| Empty source text | `VALIDATION_FAILED` 400 `translation.emptyText` |
| Provider failure | `PROVIDER_ERROR` (scrubbed upstream `error` field) |
| Cache hit | 200 with the stored text; model not invoked |

### 5. Good / Base / Bad Cases

- Good: translate to `ja`, then to `en` → both keys present in `translations`.
- Base: untranslated message → `translations` null → no block rendered.
- Bad: `set({ translations: { [lang]: text } })` — wipes the other languages.

### 6. Tests Required

- `languages.test.ts`: exactly 8 entries, codes in sync with the zod enum.
- `translation.service.integration.test.ts`: cache hit calls `generateText`
  once total, multi-language merge, sibling version untouched, ownership 404,
  empty text, provider-error mapping.
- `MessageItem.test.tsx`: persisted translation block renders with its language
  label and markdown; collapse/expand (body hidden, `aria-expanded` flips,
  language label stays, two languages independent); the in-flight placeholder
  renders for the matching language only and is replaced on arrival.
- `MessageActions.test.tsx`: the 8-language menu for both user and assistant
  roles.
- **Citation path must be tested through real Streamdown**, not only by
  asserting the `citations` prop: `MessageItem.translation-citations.test.tsx`
  builds a message whose `[1]` marker exists **only in the translation** and
  asserts a source chip renders and no literal `[1]` text remains. A
  props-level assertion alone passed while the block was still dropping the
  source map — that was the original bug.

### 7. Wrong vs Correct

#### Wrong

```tsx
// The bug this contract exists to prevent: a translation renders markdown
// without the turn's source map, so its [n] markers stay literal text.
<Markdown key={`translation-${lang}`} text={text} />
```

#### Correct

```tsx
// Sources collected from the message's own tool parts, forwarded to every
// markdown surface on the message — body, reasoning blocks, translations.
<Markdown key={`translation-${lang}`} text={text} citations={citations} />
```

## Scenario: in-flight translation feedback and collapsible blocks

### 1. Scope / Trigger

Changes to the client-side translation UX: the pending indicator, the
collapse control, or the state that drives them in `ChatView`.

### 2. Signatures

- `ChatView`: `translating: { messageId: string; targetLang: TranslateTargetLanguageCode } | null`;
  set after `ensureServerMessageId` resolves and cleared in a `finally` that
  only clears **its own** entry (compare `messageId` + `targetLang`).
- `MessageList`: `translating?: … | null` → forwarded as
  `MessageItem.translatingTargetLang` **only** to the matching message.
- `MessageItem`: `TranslationPendingBlock` (`role="status"`) and the
  collapsible `TranslationBlock`.
- i18n keys: `Chat.Translation.translating` (ICU `{language}`),
  `Chat.Translation.collapse` / `.expand`.

### 3. Contracts

- The pending block appears only after the message has a server id (a user
  message needs none; an assistant message may need one) and disappears on
  both success and failure. Success replaces it with the persisted block;
  failure surfaces `Errors.actions.translate` and leaves no placeholder.
- Collapse mechanics come from `CollapseBlock`
  (`src/components/chat/CollapseBlock.tsx`) — real `<button>` header,
  `aria-expanded` + `aria-controls={useId()}`, chevron `rotate-180`,
  `grid-rows-[1fr]`/`grid-rows-[0fr]` + inner `min-h-0 overflow-hidden`,
  `motion-reduce:transition-none`, `aria-hidden` + `inert` when closed. Do not
  hand-roll that markup per block and do not add a `ui/collapsible` primitive.
  Default is expanded; each language owns its own state (`CompressionSummary`
  is the other consumer, with `defaultOpen={false}`).
- The shimmer text class lives in `src/components/chat/shimmer.ts` and is
  shared with the thinking row and the compression-in-flight row; the pending
  marker must be purely presentational (no scroll/pin participation, see
  `../frontend/chat-scroll-behavior.md`).

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Translation of the cached language requested again | No request; block already present |
| Request fails | Placeholder cleared, `Errors.actions.translate` shown |
| Second translation started while one is in flight | First placeholder is replaced; the first request still completes and merges |
| Translation equals the source language | Model returns it unchanged; block still renders |

### 5. Good / Base / Bad Cases

- Good: pick a language → shimmer with the language's native name → text.
- Base: reload → persisted block, expanded, no request.
- Bad: keying the pending state by message id only, so a later request for the
  same message vanishes an earlier one's placeholder; or clearing `translating`
  unconditionally in `finally`, which drops a newer request's placeholder.

### 6. Tests Required

- `ChatView.test.tsx`: placeholder appears between the menu pick and the
  response, is replaced on success, and is cleared with the localized error on
  failure.
- `MessageItem.test.tsx`: placeholder for user and assistant messages,
  coexistence with an existing translation, replacement on arrival.
- `MessageList.test.tsx`: only the target message receives the placeholder.
