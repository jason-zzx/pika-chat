# web-search-tools — Technical Design

## Architecture Overview

```
┌─ Settings ────────────────────────────────┐  ┌─ Chat turn ───────────────────────────────┐
│ /settings/search (client screen)          │  │ Composer searchMode (off|builtin|tool)    │
│   ↓ TanStack Query                        │  │   ↓ sendMessage body / regenerate body     │
│ /api/search-providers/** (Route Handlers) │  │ /api/chat · regenerate route              │
│   ↓ search-provider.service.ts            │  │   ├─ builtin → chat-model fetch wrapper    │
│ search_provider_settings table            │  │   │          injects web_search_options    │
│   (encrypted keys, per-user, ordered)     │  │   └─ tool    → streamText tools: {searchWeb}│
└───────────────────────────────────────────┘  │          execute → search-chain (fallback) │
                                               │   ↓ toUIMessageStream (tool parts stream)  │
                                               │ MessageItem → SearchToolCall block         │
                                               │   ↓ onEnd persists parts jsonb             │
                                               └─────────────────────────────────────────────┘
```

## Data Model

New table `search_provider_settings` (`src/server/db/schema/search-provider.ts`):

| Column | Type | Notes |
|---|---|---|
| id | text pk | `newId()` |
| userId | text → users cascade | ownership filter on every query |
| provider | pgEnum `search_provider` (`tavily`/`exa`/`firecrawl`/`brave`) | |
| encryptedApiKey | text not null | `encryptSecret` from `src/server/crypto.ts` |
| apiKeyLastFour | text not null | returned to client instead of the key |
| baseUrl | text null | optional override; null = provider default |
| position | integer not null | fallback order; compacted on write |
| createdAt / updatedAt | timestamptz | |

Indexes: unique `(userId, provider)`; index `(userId, position)`.

No server-only import in schema files (recorded divergence in backend spec).
Migration generated with `pnpm db:generate`, committed alongside.

## API Contracts (shared zod in `src/lib/schemas/search-provider.ts`)

- `GET /api/search-providers` → `{ providers: [{ provider, baseUrl, apiKeyLastFour, position, updatedAt }] }`
  ordered by position. Composer also uses this (via a lightweight availability
  query) to know whether `tool` mode is usable.
- `PUT /api/search-providers/:provider` — body `{ apiKey?: string, baseUrl?: string | null }`.
  Create requires `apiKey`; update with omitted `apiKey` keeps the stored key.
  On create, position = max(position)+1.
- `DELETE /api/search-providers/:provider` — removes the row; remaining
  positions compacted.
- `PATCH /api/search-providers/order` — body `{ providers: SearchProvider[] }`
  (permutation of the user's configured providers); rewrites positions.

Error handling follows `src/server/errors.ts` + `withErrorHandling`; service
layer is transport-free per backend spec.

## Search Execution (`src/server/ai/search/`)

- `providers.ts` — one adapter per provider behind a common shape:
  `search(query: string): Promise<SearchResult[]>` where
  `SearchResult = { title: string; url: string; snippet: string }`; plus an
  optional `fetchPage(url): Promise<FetchResult>` where
  `FetchResult = { url: string; title?: string; content: string;
  truncated: boolean }` (cap 8000 chars, `truncated` marks the cut).
  - tavily: search `POST {baseUrl|https://api.tavily.com}/search` Bearer →
    `results[].{title,url,content}`; fetch `POST /extract` `{urls:[url]}`
    → `results[].raw_content` (`failed_results[]` = failure).
  - exa: search `POST {baseUrl|https://api.exa.ai}/search` `x-api-key`
    (`contents.text.maxCharacters: 500`) → `results[].{title,url,text}`;
    fetch `POST /contents` `{ urls: [url], text: { maxCharacters } }` →
    `results[].text`.
  - firecrawl: search `POST {baseUrl|https://api.firecrawl.dev}/v2/search`
    Bearer → `data.web[].{title,url,description}`; fetch `POST /v2/scrape`
    `{ url, formats: ["markdown"] }` → `data.markdown` +
    `data.metadata.title` (`success:false` = failure).
  - brave (R10): search switches to the LLM Context endpoint, `GET/POST
    {baseUrl|https://api.search.brave.com}/res/v1/llm/context`
    `X-Subscription-Token`, `q` + `count=5` + `maximum_number_of_urls=5` +
    `maximum_number_of_tokens=4096` → `grounding.generic[].{url,title,
    snippets[]}`; result `snippet` = its chunks joined. No fetchPage
    capability (endpoint is query-driven, cannot target a URL).
  - Per-request timeout ~10s (`AbortSignal.timeout`); non-2xx / network /
    timeout → throw.
- `chain.ts` — `runSearchChain(configuredProviders, query)`: tries each in
  `position` order; first success returns `{ provider, results }` (empty
  results = success); all failures → throws `SearchChainError` carrying the
  provider list attempted. `runFetchChain(configuredProviders, url)` filters
  to fetch-capable providers (tavily/exa/firecrawl — brave excluded), same
  win/fallback semantics.
- `tool.ts` — builds the AI SDK tools:
  `searchWeb = tool({ description, inputSchema: z.object({ query: z.string() }), execute })`
  and `fetchPage = tool({ description, inputSchema: z.object({ url: z.string().url() }), execute })`.
  Descriptions state the division of labor: searchWeb finds information,
  fetchPage reads one specific page in depth. `buildSearchTools(actor)`
  returns `{ searchWeb, fetchPage? }` — fetchPage only when ≥1 configured
  provider is fetch-capable. Executes load the caller's configured providers
  (service read + decrypt), run the chains; on total failure return
  `{ error: "search_failed" | "fetch_failed", attemptedProviders }` as a
  normal tool output (not thrown) so the model can react gracefully.
- **Source numbering (R14)**: `buildSearchTools` owns a per-request
  counter; each served `searchWeb` result and the `fetchPage` page gets a
  `num` (execution order, from 1, unique across both tools within the
  turn). `num` lives in the structured tool output — it streams, persists
  in `parts`, and replays to the model with no extra plumbing. Error
  outputs have no numbered results.

## Chat Route Wiring

`chatRequestSchema` and `regenerateMessageRequestSchema` gain
`searchMode: z.enum(["off", "builtin", "tool"]).optional()` (absent = off).

- `tool` mode: load the user's configured providers once per request; if
  non-empty pass `tools: { searchWeb }` and `stopWhen: stepCountIs(3)` to
  `streamText`; if empty, log (no secrets) and run without tools.
- `builtin` mode: `createChatModelHandle` gains an option that wraps the
  provider's `fetch`: intercept POSTs to the chat-completions path, parse the
  JSON body, add `web_search_options: {}`, re-serialize. Everything else in
  the streaming pipeline is untouched. (providerOptions passthrough is
  impossible — the openai-compatible zod schema strips unknown keys.)
- Tool parts stream automatically through `toUIMessageStream`; `onEnd`'s
  `responseMessage.parts` includes them, so persistence needs no new plumbing
  — only `chatStoredPartSchema` extension:
  `{ type: "tool-searchWeb" | "tool-fetchPage", toolCallId, state, input?, output?, errorText? }`.
- History replay: `convertToModelMessages` already maps tool parts back into
  model messages, so follow-up turns see prior searches without extra work.
- The `partsHaveText` fallback stays as-is; a tool-only stream persists its
  parts unchanged.
- **Citation instruction (R14)**: when tools are registered, append a
  citation directive to `instructions` ("when using information from
  search/fetch results, cite inline as [n] using the result's num; only
  cite nums from this turn's tool outputs"). `toolTurnStepSettings`'
  forced-step instructions override must carry the same directive.

## Frontend

- `SettingsNav` + `/settings/search` page (RSC shell) →
  `components/search/SearchProvidersScreen.tsx` (client) +
  `use-search-providers.ts` (TanStack Query). One card per provider: masked
  key input (placeholder shows `····last4` when set), optional base URL input,
  save/delete, and up/down ordering buttons (mobile-safe).
- Composer store: `searchMode` persisted alongside existing composer state.
- `Composer.tsx`: globe-icon `Popover` (non-modal, matching ModelPicker and
  constraint #16) with the three modes; `tool` option annotated/disabled with
  a settings hint when the availability query returns no providers.
- `ChatView.tsx` / `regenerate-stream.ts`: add `searchMode` to the request
  body; regenerate inherits the composer's current mode.
- `MessageItem.tsx`: replace the filter-based rendering with an ordered
  `parts.map` dispatch (`reasoning` → ReasoningBlock, `text` → Markdown,
  `tool-searchWeb` → SearchToolCall, `tool-fetchPage` → FetchToolCall,
  `step-start` → skipped). Consecutive
  reasoning parts still collapse into one block (existing behavior preserved
  by grouping adjacent same-type parts).
- `SearchToolCall.tsx`: collapsible block — expanded while
  `state === "input-streaming" | "input-available"` (running), auto-collapses
  on output; header icon reflects running/done/error; body lists results with
  title + hostname link. No external favicon service (privacy); a neutral
  letter avatar is used.
- `FetchToolCall.tsx` (R12): same collapsible shell — header "Read page" +
  page title/domain link + provider badge; body shows a truncated content
  preview (first ~500 chars), never the full text.
- **Inline citations (R14)**: `MessageItem` walks the message's tool parts
  in order and builds a `num → { title, url, provider }` source map
  (searchWeb `output.results[]`, fetchPage `output`), passed to
  `Markdown` as an optional `citations` prop. When present, an AST-level
  transform (remark-style text-visitor or Streamdown's extension point —
  verify what ai@7-era Streamdown exposes before choosing; NEVER a raw
  string regex over the whole text) rewrites `[n]` text tokens that
  resolve to a known source into citation chips; everything else,
  including `[n]` inside code/inline-code, stays untouched. The chip is a
  superscript numbered `<button>` (muted pill, e.g. ChatGPT-style) whose
  click opens `ExternalLinkDialog` for that source's URL. Unresolvable
  markers render as literal text. Streaming-safe: chips appear as soon as
  both the marker text and its source exist.
- Scroll contract: tool blocks grow inside the message; the existing
  ResizeObserver follow behavior (chat-scroll-behavior spec, disjunct 3)
  keeps a bottom-pinned view glued. No new scroll logic; verify no regression
  via existing MessageList tests plus one tool-part growth case.

## Compatibility & Trade-offs

- `searchMode` absent in old clients = `off` — fully backward compatible.
- Tool parts in `parts` jsonb are forward-compatible for history (old rows
  simply have no tool parts).
- Builtin mode is honest best-effort: vendors ignoring `web_search_options`
  silently degrade to normal completion (documented in settings copy).
- Search provider configs are private-only (no shared visibility like model
  providers) — keeps the table and authz simple; can be revisited later.
- Multiple tool steps per turn are bounded by `stepCountIs(5)` (raised in
  R7; kept at 5 per product decision even with fetchPage — Brave's
  in-search content reduces fetch round-trips).

## Operational / Rollback

- Additive migration only; rollback = revert code + drop the new table.
- Default mode `off` preserves current behavior exactly; feature risk is
  isolated to opt-in modes.
