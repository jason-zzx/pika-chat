# web-search-tools

## Goal

Give the LLM access to web search, and make tool activity visible in the chat UI:

1. **Search tool providers** — integrate Tavily, Exa, Firecrawl, and Brave as
   function-calling tools. Users configure each provider's API key and optional
   base URL in settings (user-level isolation) and order them as a fallback
   chain.
2. **Composer search mode** — a three-state toggle: off / model-builtin search /
   app-side search tool. Shown for every model without capability probing.
3. **Tool call rendering** — chat messages render tool call blocks
   (ChatGPT/LobeHub-style collapsible cards), with the search tool's query,
   status, and results displayed this iteration.

## Confirmed Facts (from code inspection)

- Chat streaming uses Vercel AI SDK: `streamText` + `createUIMessageStream` +
  `toUIMessageStream` in `src/app/api/chat/route.ts`; the regenerate route
  `src/app/api/topics/[id]/messages/[messageId]/regenerate/route.ts` mirrors
  the same pipeline minus topic/user-message handling.
- All models go through `@ai-sdk/openai-compatible` (`createOpenAICompatible`
  in `src/server/ai/chat-model.ts`). Its providerOptions are parsed through a
  zod schema (`openaiCompatibleLanguageModelChatOptions`) that strips unknown
  keys — vendor-specific builtin-search fields cannot pass through
  providerOptions. `createOpenAICompatible` accepts a custom `fetch`, which can
  inject extra request-body fields.
- Message `parts` are persisted as jsonb in `chat_messages.parts`
  (`src/server/db/schema/chat.ts`); the shared stored-part zod schema is
  `chatStoredPartSchema` in `src/lib/schemas/chat.ts` (text / reasoning /
  step-start today). `convertToModelMessages` replays tool parts into model
  context automatically once the schema accepts them.
- `MessageItem.tsx` currently renders only `text` and `reasoning` parts
  (filtered, not interleaved).
- User-owned credentials already follow a proven pattern:
  `provider_configs` (ownerId + `encryptedApiKey` via
  `src/server/crypto.ts` AES-256-GCM + `apiKeyLastFour`).
- Settings navigation lives in `src/components/layout/SettingsNav.tsx`
  (General / Account / Providers / Users); settings pages under
  `src/app/(app)/settings/`.
- Composer state is zustand-persisted (`src/stores/composer-store.ts`); the
  chat request body is assembled in `ChatView.tsx` (`sendMessage` body) and
  `regenerate-stream.ts`.

## Decisions (from user)

1. Search is exposed to the model via **function calling** (model decides when
   to search); not forced search-every-turn.
2. Provider priority order = **fallback chain**: first configured provider is
   tried first, next one on failure.
3. "Model builtin search" means OpenAI-style builtin web search
   (`web_search_options`), Gemini grounding, etc. The three-state toggle shows
   for **all models without capability verification**.
4. Tool call display follows **ChatGPT-style**: collapsible "Searched the web"
   block with sources.
5. Streaming/tool-call wiring determined by code inspection (see above).

## Requirements

### R1 — Search provider settings (user-level)

- New settings page `/settings/search` (+ "Search" entry in `SettingsNav`).
- For each of tavily / exa / firecrawl / brave: save, update, and delete an
  API key (masked input; server stores it encrypted and returns only
  `apiKeyLastFour`); optional custom base URL.
- Ordering UI to arrange configured providers into the fallback chain
  (touch-friendly up/down controls, per mobile constraint — no drag-only
  interaction).
- Route Handlers under `/api/search-providers/**`; every query filtered by
  the caller's user id; zod validation at the boundary.

### R2 — Search tool execution with fallback

- A `searchWeb` tool (input: `{ query: string }`) registered on `streamText`
  when the request's search mode is `tool` and the user has at least one
  configured provider.
- Execution walks the user's providers in priority order; the first provider
  that returns without error wins. An empty result set is a valid answer and
  does **not** trigger fallback; network/HTTP/auth errors do.
- If every provider fails, the tool returns an error output to the model (the
  model can then answer without search or tell the user search failed).
- Multi-step: the model may search more than once per turn (bounded
  `stopWhen`).
- No API keys, queries, or raw result payloads in logs beyond the existing
  logging redaction rules.

### R3 — Composer search mode

- Three-state control in the composer: **off** (default) / **builtin** /
  **tool**, rendered for all models (no capability probing).
- Persisted in composer store so the choice survives reloads.
- `searchMode` is sent with both `/api/chat` and regenerate requests
  (regenerate inherits the composer's current mode, matching the existing
  rule that regeneration uses the composer's current model/effort).
- When `tool` is selected but no provider is configured, the composer shows a
  hint linking to `/settings/search`; the server degrades gracefully by
  running the turn without the tool.

### R4 — Builtin search (best-effort)

- When search mode is `builtin`, the server injects OpenAI-convention
  `web_search_options: {}` into the chat-completions request body via a custom
  `fetch` wrapper around the openai-compatible provider.
- Vendors that ignore the field degrade to a normal completion — accepted
  behavior, documented; no per-vendor adaptation this iteration.

### R5 — Tool call rendering

- Assistant messages render parts **interleaved in part order**: reasoning
  block, text (Markdown), and tool blocks.
- `tool-searchWeb` part renders as a collapsible block (default collapsed
  once finished, expanded while running):
  - header: spinner/check/error icon + "Searched the web" + the query
  - body: provider badge and the result list (title + domain, linking to the
    URL); error state shows failure text
- Works during streaming (`input-streaming` → `input-available` →
  `output-available` / `output-error`) and on history reload from persisted
  parts.
- Touch-accessible toggle (no hover-only affordances); respects existing
  scroll contracts in `.trellis/spec/frontend/chat-scroll-behavior.md`
  (tool-block growth while bottom-pinned follows the same ResizeObserver
  rules as other async content).

## Acceptance Criteria

- [ ] A user can save/update/delete API keys (+ optional base URL) for each of
      the four search providers on `/settings/search`; only `apiKeyLastFour`
      is ever returned to the client; another user cannot read or modify them.
- [ ] Providers can be reordered; the order persists and defines fallback
      order.
- [ ] With search mode `tool` and a valid provider configured, asking a
      search-dependent question produces a visible search tool block in the
      reply, during streaming and after reload.
- [ ] With the first provider's key invalid and the second valid, the search
      succeeds via the second provider (fallback); the rendered block shows
      which provider served the results.
- [ ] With all providers failing, the tool block shows an error state and the
      assistant still produces a text answer.
- [ ] Search mode `builtin` sends `web_search_options: {}` in the upstream
      request body (verifiable via a mock provider / unit test); mode `off`
      sends neither tools nor the field.
- [ ] Tool parts persist in `chat_messages.parts`, survive reload, and are
      included when the conversation is replayed to the model.
- [ ] Regenerate with a search mode set applies that mode to the new version;
      existing versions keep their own persisted parts unchanged.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; new service/tool logic
      has Vitest coverage.
- [ ] In a multi-step search turn, each reasoning phase collapses to "Thought"
      with its own duration when it ends; durations survive reload.
- [ ] A turn whose model would search more times than the budget still ends
      with a text answer (final step forced to no-tools), never dangling on a
      tool result.
- [ ] While waiting for the model after a tool result, a thinking indicator
      is visible; it disappears when the next reasoning/text starts or the
      stream ends.
- [ ] A weak model that leaks `<tool_call>` markup as text on the forced
      final step has it stripped (live and persisted); the forced step also
      drops tool definitions and carries an explicit answer-now instruction.
- [ ] Brave search calls the LLM Context endpoint with token budgets and
      returns extracted page chunks as result snippets (fixture-verified).
- [ ] With a fetch-capable provider configured, the model can call
      `fetchPage` on a URL and gets page content (≤8000 chars, `truncated`
      flagged); the block renders collapsed and survives reload.
- [ ] With only Brave configured, `fetchPage` is not registered.
- [ ] Fetch failures fall back along the chain; total failure yields a
      normal error tool output and the assistant still answers.
- [ ] `FetchToolCall` header: whole row toggles expansion, chevron far
      right, only the title area opens the external-link confirm dialog
      (Close / Open link), which opens the URL in a new tab on confirm.
- [ ] In a tool-mode turn, served results carry unique `num`s across
      multiple search/fetch calls; the model's `[n]` citations render as
      superscript chips that open the external-link dialog for the right
      URL — live and after reload; markers inside code or without a
      matching source stay plain text.

## Out of Scope

- Per-vendor builtin-search adaptation (OpenRouter plugins, Qwen
  `enable_search`, etc.).
- Search results as file attachments, image search, news/date-filtered search
  parameters.
- Sharing search provider configs between users (unlike model provider
  configs, these stay private-only).

## Bug-Fix Requirements (found in real usage after first implementation)

### R6 — Per-step reasoning blocks and durations

Multi-step tool turns produce one reasoning phase per step. Each reasoning
phase must render as its own block and collapse to "Thought" with **its own**
duration as soon as that phase ends — not only at the end of the whole turn.

Root cause (anchors): `src/server/ai/reasoning-timer.ts` measures only the
first reasoning phase (once `endedAt` is set it never measures again);
`reasoningMs` is a single message-level value; `MessageItem` shows it on the
primary reasoning block only.

### R7 — Tool turns must always end with an answer

Observed: after several search rounds the stream sometimes stops at the tool
results with no answer. Root cause: both streaming routes cap at
`stopWhen: stepCountIs(3)` (`api/chat/route.ts:171`, regenerate
`route.ts:151`) — if the model spends all steps on searches there is no
answer step left.

Fix shape: raise the step budget (5) and use ai@7 `prepareStep` to force
`toolChoice: "none"` on the final allowed step, so the turn always ends with
a text answer.

### R8 — Waiting indicator between tool result and next step

After a tool call completes, while waiting for the model's next step there is
no UI feedback (thinking shimmer only shows when the message has no content
blocks at all — `MessageItem.tsx` `showThinkingShimmer`). While the tail
message is streaming and its last content block is a tool block (or no
text/reasoning is active), show the thinking shimmer so waiting is
distinguishable from finished.

### R9 — Leaked tool-call markup from weak models on the forced answer step

Observed (topic `01a07c62-091b-71e3-a29a-da1f3985afa5`, version 3,
sensenova-6.8-flash-lite): the model ran 8 structured searches over 4 steps,
then on the forced `toolChoice: "none"` step emitted its native Hermes-style
`<tool_call><function=searchWeb><parameter=query>…` markup as **plain text**
instead of answering. The forced step guarantees text exists, but the text
can be markup garbage.

Fix shape (two layers):

1. **Prevention** — on the forced final step, additionally remove tool
   definitions (`activeTools: []`) and override `instructions` to append an
   explicit "answer now with what you have, do not call tools" directive
   (prepareStep supports both; the override carries forward but the forced
   step is the last one).
2. **Sanitization** — strip leaked `<tool_call>…</tool_call>` markup
   (including stray `<function=…>` / `<parameter=…>` fragments and
   unterminated trailing blocks) from text: live via an
   `experimental_transform` stream transform (holdback buffer for partial
   tags), and again over text parts at onEnd before persistence as a safety
   net. Text parts that sanitize to empty are dropped.

Accepted trade-off: legitimately quoted `<tool_call>` markup inside an
assistant answer (e.g. discussing the syntax) is also stripped in tool-mode
turns; leakage is far more common than that discussion. If sanitization
leaves the forced step with no visible text at all, the turn ends on the
tool blocks — accepted residual, no fabricated fallback text.

### R10 — Brave search via LLM Context

Brave's adapter switches from `/res/v1/web/search` (description snippets
only) to the LLM Context endpoint (`/res/v1/llm/context`, launched
2026-02), which returns pre-extracted page content chunks per ranked URL
(text/tables/code, token-budget controlled). A Brave search then gives the
model real page content in one call — no follow-up fetch needed.
Constraint: the endpoint is query-driven (cannot target a specific URL), and
may require a specific subscription tier; access errors (401/403) surface as
provider failures and advance the fallback chain unchanged. The user's
instance currently has no Brave key configured, so this path is implemented
per documented contract and unit-tested with fixtures; live verification is
deferred until a Brave key exists.

### R11 — `fetchPage` tool (URL-driven content)

A second tool, `fetchPage({ url })`, lets the model read the full content of
a specific page (typically a URL from a prior `searchWeb` result).
Execution walks the user's priority chain but **only over providers with a
URL-fetch capability**: Tavily `/extract`, Exa `/contents`, Firecrawl
`/v2/scrape`. Brave is skipped (no URL-fetch endpoint). No self-built
generic scraping fallback (explicit product decision). Content is
normalized to text/markdown, truncated at 8000 chars with a `truncated`
flag in the output. If no configured provider can fetch URLs, `fetchPage`
is not registered at all (the model cannot hallucinate the call). Total
fetch failure returns a normal error tool output, same pattern as R2.
Step budget stays at 5 (Brave's in-search content reduces fetch round-trips;
accepted constraint for fetch-heavy flows). Tool descriptions make the
division of labor explicit: `searchWeb` finds information, `fetchPage`
reads one page in depth; the model chooses.

### R12 — `fetchPage` rendering

`tool-fetchPage` parts render as a collapsible block mirroring the search
block (R5): header icon + "Read page" + page title/domain linking to the
URL, provider badge; expanded body shows a truncated content preview (the
full text is not dumped into the UI). Works during streaming and on reload;
same scroll contracts.

### R13 — Tool block header parity + external-link confirmation

Observed: `FetchToolCall`'s header interaction diverges from
`SearchToolCall` — the toggle button wraps only icon+label+chevron, the
title is a separate `target="_blank"` anchor that navigates immediately,
and clicking elsewhere on the row does nothing.

Required behavior (matching `SearchToolCall`):

- Clicking **anywhere on the header row** toggles expand/collapse, except
the title area.
- The expand/collapse chevron sits at the **far right** of the row.
- Only the **title area** (page title / domain) triggers navigation — and
  it does not navigate directly: it opens an **external-link confirmation
  dialog** that matches the message-body dialog **visually**, not just in
  copy. Message-body links use Streamdown's built-in `linkSafety` modal;
  mirror its structure and classes: backdrop `bg-background/50
  backdrop-blur-sm`; card `max-w-md rounded-xl border bg-background p-6
  shadow-lg gap-4`; top-right X close button; header = ExternalLinkIcon
  (size 20) + "Open external link?" (`font-semibold text-lg`); warning
  "You're about to visit an external website." (`text-muted-foreground
  text-sm`); URL in a `break-all rounded-md bg-muted p-3 font-mono text-sm`
  box (`max-h-32 overflow-y-auto` over 100 chars); button row = Copy link
  (outline, flex-1, copy feedback "Copied" — use `copyTextToClipboard`, not
  the raw Clipboard API) + Open link (primary, flex-1, ExternalLinkIcon 14,
  `window.open(url, "_blank", "noreferrer")`).
- No nested-interactive HTML (no `<a>` inside `<button>`); keyboard
  reachable with visible focus; touch parity (tap title → dialog, tap row
  → toggle).
- Search result links inside the expanded search body stay plain anchors
  this iteration (user-scoped decision: only the fetch title gets the
  dialog).

### R14 — Inline source citations in the answer text

ChatGPT-style `[n]` markers in the answer, resolving to the turn's tool
sources. Model-generated (instruction-based), never a hard guarantee.

- **Source numbering**: every served result gets a `num` field —
  `searchWeb` results and the `fetchPage` page alike. Numbering comes from
  a per-request counter shared across both tools (unique within the turn,
  execution order, starting at 1). Error outputs carry no `num`.
- **Citation instruction**: when search mode is `tool` and tools are
  registered, append a citation directive to `instructions` ("cite sources
  inline as [n] using the result's num; only cite nums from this turn's
  tool outputs"). The R9 forced-step `instructions` override must retain
  the directive — the forced answer step is where citations get written.
- **Rendering**: `MessageItem` collects the message's numbered sources
  from its tool parts and passes them to `Markdown`; `[n]` markers that
  resolve to a known source render as a superscript numbered citation
  chip; clicking a chip opens `ExternalLinkDialog` for that URL (same
  dialog as R13). Unresolvable markers (out of range, no sources, model
  noise) render as plain text.
- **AST-safe transform**: the `[n]` → chip conversion must operate on the
  markdown AST (or an equivalent code-aware mechanism) — never transform
  inside fenced code or inline code (`a[1]` stays code).
- Works incrementally during streaming (chips appear as text arrives once
  the referenced source exists) and after reload (nums persist inside the
  tool outputs in `parts`; citations are render-time, no new persistence).
- Off/builtin modes unchanged; a model that never cites is valid output.

## Open Questions

(none blocking)
