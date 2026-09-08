# Chat Search Tools Contract

> Cross-layer contract for web search: user-level search provider settings,
> the `searchWeb` function-calling tool with provider fallback, the composer
> `searchMode` (off / builtin / tool), builtin search via fetch injection, and
> tool-call part persistence/rendering. Landed with `09-07-web-search-tools`.

## Scenario: touching search tools, search provider settings, or tool-call parts

### 1. Scope / Trigger

Any change to search provider configuration, the `searchWeb` tool, the
`searchMode` request field, builtin search injection, or `tool-searchWeb`
message parts. These cross schema → service → routes → streamText → persisted
parts → UI — change them together.

### 2. Signatures

- DB: `searchProviderSettings` (`src/server/db/schema/search-provider.ts`) —
  `userId` FK cascade, `provider` pgEnum (`tavily`/`exa`/`firecrawl`/`brave`),
  `encryptedApiKey` + `apiKeyLastFour`, nullable `baseUrl`, `position`
  integer; unique `(userId, provider)`, index `(userId, position)`. No
  `visibility` — private-only by design.
- Service (`src/server/services/search-provider.service.ts`):
  `listSearchProviderSettings(actor)` (position-ordered),
  `upsertSearchProviderSetting(input, actor)` (create requires `apiKey`;
  omitted key on update preserves the stored one),
  `deleteSearchProviderSetting(provider, actor)` (compacts positions),
  `reorderSearchProviders(providers, actor)` (permutation-validated),
  `resolveSearchProviderCredentials(actor)` → `SearchProviderCredential[]`
  (decrypts at execution time; the only function returning usable keys).
- Routes: `GET /api/search-providers`,
  `PUT/DELETE /api/search-providers/[provider]`,
  `PATCH /api/search-providers/order`. Response DTOs carry
  `apiKeyLastFour`, never the key.
- Tool: `createSearchWebTool(credentials)` (`src/server/ai/search/tool.ts`)
  builds `searchWeb` with input `{ query: string }`; credentials are
  resolved **once per request** in the route, not per tool call.
- Fallback: one generic `runChain(entries, input)`
  (`src/server/ai/search/chain.ts`; entries `{ provider, call }`, all-fail
  throws `ChainError` with the attempted list) — used for both search and
  fetch.
- History replay: `replayModelMessages(messages)`
  (`src/server/ai/model-messages.ts`) — both streaming routes MUST use it
  instead of bare `convertToModelMessages` (see Contracts).
- Builtin: `withBuiltinWebSearch(base?)` (`src/server/ai/builtin-search.ts`)
  returns a `fetch` that injects `web_search_options: {}` into
  chat-completions POST bodies; wired via
  `createChatModelHandle(pair, actor, { builtinSearch: true })`.
- Schemas (`src/lib/schemas/search-provider.ts`): `searchModeSchema` =
  `z.enum(["off", "builtin", "tool"])`, `searchWebToolInputSchema`,
  `searchWebToolOutputSchema` (union: success `{ provider, query, results }`
  | `{ error: "search_failed", attemptedProviders }`).

### 3. Contracts

- **`searchMode` absent = `off`** — old clients keep working. `tool`
  registers `tools: { searchWeb, fetchPage? }` (`fetchPage` only when a
  fetch-capable provider is configured — the model cannot call what is not
  registered) plus `toolTurnStepSettings()`
  (`src/server/ai/search/tool.ts`): `stopWhen: stepCountIs(5)` with
  `prepareStep` acting on the final allowed step, so a
  model that spends every step searching still ends the turn with a text
  answer instead of dangling on tool results. The forced step does three
  things (all required — `toolChoice: "none"` alone makes weak models leak
  their native Hermes-style `<tool_call>` markup as plain text, observed on
  sensenova-6.8-flash-lite): `toolChoice: "none"`, `activeTools: []`
  (definitions removed), and an `instructions` override appending
  `FORCED_STEP_DIRECTIVE` ("answer now, do not call tools or emit tool-call
  markup"). Settings apply only when the
  user has ≥1 configured provider; otherwise the turn runs tool-less with a
  secret-free log. `builtin` attaches the fetch wrapper; `off` attaches
  neither. Regenerate inherits the composer's current mode; old versions keep
  their own persisted parts.
- **Leaked tool-call markup is stripped** (`src/server/ai/search/markup-sanitizer.ts`):
  `stripToolCallMarkup(text)` removes complete/unterminated `<tool_call>`
  blocks and stray `<function=…>`/`<parameter=…>` fragments. It runs live via
  `experimental_transform: stripToolCallMarkupTransform()` on tool-mode turns
  (holdback buffer for chunk-split tags; clean text passes unbuffered), and
  again at onEnd via `stripMarkupFromTextParts` as a persistence safety net,
  dropping text parts that sanitize to whitespace. Accepted trade-off:
  legitimately quoted `<tool_call>` markup in an answer is also stripped in
  tool-mode turns. Non-tool turns are untouched.
- **Fallback semantics**: providers tried in `position` order; first
  error-free response wins; **an empty result set is a valid answer and does
  NOT trigger fallback**; only network/HTTP/timeout/malformed errors advance
  the chain. Total failure returns the `search_failed` output as a normal
  tool result (never thrown) so the model can answer gracefully.
- **Provider adapters** (`src/server/ai/search/providers.ts`). Search:
  Tavily POST `/search` Bearer; Exa POST `/search` `x-api-key` (500-char
  text); Firecrawl POST `/v2/search` Bearer; Brave (R10) GET-only
  `/res/v1/llm/context` `X-Subscription-Token` with `count=5`,
  `maximum_number_of_urls=5`, `maximum_number_of_tokens=4096` →
  `grounding.generic[].{url,title,snippets[]}`, each result's `snippet` is
  its extracted chunks joined (query-driven; tier-gated → access errors
  advance the chain like any failure). Fetch (R11): Tavily POST `/extract`
  `{ urls: [url] }` → `results[].raw_content` (`failed_results[]` counts as
  failure); Exa POST `/contents` `{ urls: [url], text: { maxCharacters } }`
  → `results[].text`; Firecrawl POST `/v2/scrape` `{ url, formats:
  ["markdown"] }` → `data.markdown` (`success: false` = failure); Brave has
  no URL-fetch endpoint and is excluded from the fetch chain. All: 10s
  `AbortSignal.timeout`, zod-parsed responses, error strings carry provider
  + status only (upstream bodies can echo secrets).
- **Fetch normalization**: `FetchResult = { url, title?, content,
  truncated }`; content capped at `FETCH_CONTENT_LIMIT = 8000` chars with
  `truncated: true` when cut. The fetch `runChain` call filters the user's
  chain to
  fetch-capable providers in position order (same win/fallback semantics as
  search); total failure returns `{ error: "fetch_failed",
  attemptedProviders }` as a normal tool output. No self-built generic
  scraping fallback (product decision).
- **`replayModelMessages` is load-bearing** (`ignoreIncompleteToolCalls:
  true`): interrupted streams persist incomplete tool parts by design
  (retained-versions contract), and converting such a part yields a
  tool-call with no matching tool result — strict vendors then 400 every
  follow-up turn, permanently wedging the topic. Never call bare
  `convertToModelMessages` in a streaming route.
- **Source numbering + citation instruction** (R14): `buildSearchTools`
  owns a per-request counter shared by both tools; every served
  `searchWeb` result and the `fetchPage` page is stamped with `num`
  (execution order, from 1, unique within the turn; error outputs carry
  no nums). `num` is OPTIONAL in the output zod schemas — pre-R14 rows
  parse and simply yield no citations. When tools are registered, both
  routes append `CITATION_DIRECTIVE` to `instructions` via
  `withCitationDirective` ("cite inline as [n] using the result's num;
  only this turn's nums"); the forced-step override appends (never
  replaces), so the directive survives onto the answer step. The
  assistant's `[n]` markers are model-generated best-effort — weak models
  may skip citing; that is valid output.
- **Builtin injection mechanism**: `web_search_options` cannot travel through
  `providerOptions` — `@ai-sdk/openai-compatible` parses options through a
  zod schema that strips unknown keys. The fetch wrapper rewrites the request
  body instead, passing through untouched on any mismatch/parse failure.
  Vendors ignoring the field degrade to a normal completion (best-effort by
  design).
- **Part rendering**: `tool-searchWeb` / `tool-fetchPage` parts persist in
  `parts` jsonb via the state-discriminated union in
  `chatStoredPartSchema`. `MessageItem` renders parts interleaved in part
  order (adjacent reasoning parts still group into one block; `step-start`
  skipped). `SearchToolCall` / `FetchToolCall` take a `streaming` prop: an
  incomplete part renders as running ONLY while the message is live;
  persisted incomplete parts render collapsed as "Search/Read interrupted"
  — without the hint they spin forever on history reload. `FetchToolCall`
  header: "Read page" + title/domain + provider badge; body shows a
  truncated content preview, never the full text.
- **Tool-block header interaction** (R13): the whole header row toggles
  expansion via the overlay pattern — an `absolute inset-0` toggle button
  under a `pointer-events-none` content row, with the title re-enabling
  `pointer-events-auto` (siblings, never nested interactives); chevron far
  right. `FetchToolCall`'s title opens `ExternalLinkDialog`
  (ui/alert-dialog as the a11y base) instead of navigating directly —
  structure- and class-level parity with Streamdown's built-in
  `linkSafety` modal that message-body links already use (Streamdown
  enables it by default): blurred `bg-background/50` backdrop, `rounded-xl
  border bg-background p-6` card, X close top-right, icon + "Open external
  link?", mono URL box (`bg-muted`, max-h-32 scroll over 100 chars), Copy
  link (via `copyTextToClipboard`, "Copied" feedback) + Open link
  (`window.open(url, "_blank", "noreferrer")`). Card margins use
  `w-[calc(100%-2rem)]`, NOT `mx-4` — the popup is fixed +
  `-translate-x-1/2`, where margins break centering and overflow narrow
  viewports. Search
  result links inside the expanded search body stay plain anchors (scoped
  product decision).
- **Trailing thinking indicator**: while the tail message streams, the
  Thinking shimmer shows when there are no content blocks yet OR the last
  block is a *finished* tool call (the model is composing the next step). A
  running tool block shows its own spinner instead, and the shimmer hides as
  soon as next-step reasoning/text starts or the stream ends (R8).
- **Per-step reasoning durations**: multi-step tool turns produce one
  reasoning phase per step; each phase collapses to "Thought" with its own
  duration as soon as that phase ends. See chat-message-metadata.md for the
  `reasoningDurations` early-emit/persistence contract (R6).

### 4. Validation & Error Matrix

- `PUT` create without `apiKey` → `VALIDATION_FAILED`; update omitting
  `apiKey` → stored key preserved.
- Reorder body not a permutation of the user's configured providers →
  `VALIDATION_FAILED`.
- Cross-user read/write of a setting → `NOT_FOUND` (ownership filter in
  WHERE, no existence oracle).
- All providers fail → tool output `{ error: "search_failed",
  attemptedProviders }`, assistant still answers; UI shows the error state.
- Tool mode with zero configured providers → turn runs without tools;
  composer disables "Search tool" with a `/settings/search` link.

### 5. Good / Base / Bad Cases

- Good: new search provider → add pgEnum value + adapter + `provider-meta`
  entry + fixtures/tests; chain, service, UI pick it up generically.
- Base: legacy message rows have no tool parts; unknown/malformed persisted
  parts are dropped per-item on load (`uiPartsFromJson`), never failing the
  message.
- Bad: forcing a search per turn (search is model-decided function calling);
  throwing from the tool on total failure (truncates the stream); falling
  back on empty results (a valid "nothing found" answer).

### 6. Tests Required

- Service: CRUD/reorder/isolation integration tests; raw key never in any
  HTTP response.
- Adapters: fixture-response parsing per provider; non-2xx/timeout throws;
  error strings exclude upstream bodies.
- Chain: fallback order, empty-results-not-fallback, all-fail error carries
  attemptedProviders.
- `model-messages.test.ts`: incomplete tool parts dropped on replay;
  `output-available` parts replay with results.
- `chat-model.test.ts`: fetch wrapper attached only when
  `builtinSearch: true`.
- `SearchToolCall` tests: live running spins/expands; persisted incomplete
  part in stopped/failed message renders collapsed non-spinning.

### 7. Wrong vs Correct

#### Wrong

```ts
// Bare conversion in a streaming route — interrupted topics wedge on the
// next turn (tool-call with no tool result → vendor 400).
const modelMessages = await convertToModelMessages(originalMessages);
```

```ts
// Tool throws on total failure — the stream dies instead of letting the
// model answer "search failed".
throw new ChainError(attempted);
```

#### Correct

```ts
const modelMessages = await replayModelMessages(originalMessages);
```

```ts
// Normal tool output; the model reacts gracefully.
return { error: "search_failed", attemptedProviders };
```
