# web-search-tools — Implementation Plan

## Ordered Checklist

1. **Schema + migration**
   - `src/server/db/schema/search-provider.ts` (table + `search_provider`
     pgEnum), export from `schema/index.ts`.
   - `pnpm db:generate` → commit migration.
   - Validate: migration applies on empty DB (integration harness).

2. **Shared zod contracts**
   - `src/lib/schemas/search-provider.ts`: `searchProviderSchema` enum,
     upsert body, reorder body, response DTO.
   - `src/lib/schemas/chat.ts`: `searchMode` on `chatRequestSchema` +
     `regenerateMessageRequestSchema`; extend `chatStoredPartSchema` with the
     `tool-searchWeb` part.

3. **Service layer**
   - `src/server/services/search-provider.service.ts`: list (ordered),
     upsert, delete (compact positions), reorder. Ownership filters on every
     query; encrypt via `encryptSecret`; never return the key.
   - Unit tests + integration tests (mirror `provider.service` test style).

4. **Route Handlers**
   - `src/app/api/search-providers/route.ts` (GET)
   - `src/app/api/search-providers/[provider]/route.ts` (PUT, DELETE)
   - `src/app/api/search-providers/order/route.ts` (PATCH)

5. **Search execution core**
   - `src/server/ai/search/providers.ts` — 4 adapters + timeout; verify each
     provider's exact request/response fields against current docs before
     coding the adapter.
   - `src/server/ai/search/chain.ts` — fallback chain.
   - `src/server/ai/search/tool.ts` — `searchWeb` AI SDK tool.
   - Unit tests: adapter parsing (fixture responses), chain fallback order,
     empty-results-not-fallback, all-fail error output.

6. **Chat/regenerate route wiring**
   - `chat-model.ts`: optional builtin-search `fetch` wrapper injecting
     `web_search_options: {}`.
   - `api/chat/route.ts` + regenerate route: resolve searchMode, register
     `searchWeb` tool + `stopWhen: stepCountIs(3)` when usable.
   - Unit test: builtin wrapper adds the field; off adds nothing.

7. **Settings UI**
   - `SettingsNav.tsx` (+ test): "Search" entry.
   - `src/app/(app)/settings/search/page.tsx` (RSC shell).
   - `src/components/search/SearchProvidersScreen.tsx`,
     `use-search-providers.ts`: provider cards, key/base-url forms,
     delete, up/down ordering.

8. **Composer search mode**
   - `composer-store.ts`: persisted `searchMode`.
   - `Composer.tsx`: non-modal popover, three states, tool-unavailable hint.
   - `ChatView.tsx` + `regenerate-stream.ts`: body wiring.

9. **Tool call rendering**
   - `SearchToolCall.tsx` + tests (running/done/error, stream states).
   - `MessageItem.tsx`: ordered interleaved part rendering (preserve
     reasoning grouping + existing behaviors).
   - `MessageList`/scroll: add a tool-part growth case to existing tests;
     confirm chat-scroll-behavior contracts hold.

## Fix Iteration (post-implementation bug findings)

10. **Per-step reasoning durations (R6)**
    - `reasoning-timer.ts`: measure every reasoning phase, not just the first
      (open on reasoning-start/delta, close on reasoning-end or first
      text/tool chunk after it; finish closes an open phase). Expose all
      phase durations.
    - Route: early-emit cumulative `reasoningDurations: number[]` via
      message-metadata as each phase closes (existing early-emit pattern);
      finish metadata carries the full list.
    - Persistence: zip per-phase durations into the reasoning parts in
      `parts` jsonb at onEnd (`durationMs` on the reasoning part variant of
      `chatStoredPartSchema`) — no new column. `metadataFromRow` derives
      `reasoningDurations` from parts on history load. Keep the existing
      `reasoningMs` column for compat (persist the total).
    - `MessageItem`/`ReasoningBlock`: block i (in reasoning-block order)
      shows duration i — live from metadata, reloaded from part.
11. **Guaranteed final answer (R7)**
    - Both routes: `stopWhen: stepCountIs(5)` + `prepareStep` forcing
      `toolChoice: "none"` on the last allowed step.
    - Test: a stub model that would call tools on every step still ends with
      text on the forced step.
12. **Trailing thinking shimmer (R8)**
    - `MessageItem`: show the shimmer while `streaming` and (no content
      blocks OR the last block is a tool block / no active reasoning/text).
    - Tests: shimmer visible after tool output while streaming; hidden once
      next text/reasoning starts; hidden when not streaming.

13. **Leaked markup prevention + sanitization (R9)**
    - `toolTurnStepSettings()`: forced step also sets `activeTools: []` and
      overrides `instructions` with an appended answer-now directive.
    - New `experimental_transform` stream transform stripping leaked
      `<tool_call>` markup from text deltas (holdback buffer for partial
      tags across chunk boundaries); same pure sanitizer function re-run over
      text parts at onEnd as a persistence safety net; empty-after-strip
      text parts dropped. Applied on tool-mode turns (both routes).
    - Unit tests: markup split across chunk boundaries; unterminated
      trailing block; mixed text+markup; clean text passthrough; onEnd net;
      prepareStep overrides on the forced step.

14. **Brave LLM Context upgrade (R10)**
    - `providers.ts` brave adapter: switch to `GET /res/v1/llm/context`
      (`q`, `count=5`, `maximum_number_of_urls=5`,
      `maximum_number_of_tokens=4096`); map `grounding.generic[]` →
      `SearchResult[]` with `snippet` = chunks joined; zod-parse; empty
      `grounding.generic` = valid empty answer (no fallback).
    - Unit tests: fixture parsing, empty grounding, error passthrough.
    - No live key on the instance — contract from docs, live check deferred.
15. **`fetchPage` tool (R11)**
    - `providers.ts`: `fetchPage` on tavily (`/extract`), exa (`/contents`),
      firecrawl (`/v2/scrape`); normalize to `FetchResult` with 8000-char
      cap + `truncated` flag.
    - `chain.ts`: `runFetchChain` over fetch-capable providers only.
    - `tool.ts`: `buildSearchTools` returns `{ searchWeb, fetchPage? }`;
      conditional registration; graceful `fetch_failed` output.
    - `chatStoredPartSchema`: add `tool-fetchPage` variant; both routes
      register the tools record.
    - Unit tests: adapter fixtures (incl. `failed_results` / `success:false`
      failure), chain capability filtering, truncation, gating.
16. **`fetchPage` rendering (R12)**
    - `FetchToolCall.tsx`: collapsible "Read page" block (title/domain link,
      provider badge, truncated preview); streaming + persisted states.
    - `MessageItem.tsx`: dispatch `tool-fetchPage` parts.
    - Tests: running/done/error/interrupted states.

17. **Fetch URL matching hardening (check follow-up)**
    - Exa `/contents` returns the requested URL in `id` and the canonical
      (possibly redirected/normalized) URL in `url` — matching `results` by
      exact `url === requestedUrl` misses after normalization and spuriously
      advances the fallback chain. Match Exa results by `id` (fall back to
      `url`), and for both Exa/Tavily accept the single result when exactly
      one URL was requested.
    - Add an explicit `tool-fetchPage` replay/drop case to
      model-messages tests (lock the state-based contract).
    - Tighten spec wording: Brave adapter is GET-only.

18. **FetchToolCall header parity + link dialog (R13)**
    - Restructure the header to `SearchToolCall`'s interaction model:
      whole-row toggle (overlay-button pattern: absolute inset-0 toggle
      button under a pointer-events-none content row, title button with
      pointer-events-auto — no nested interactives), chevron far right,
      provider badge before chevron.
    - Title click opens a new `ExternalLinkDialog` (ui/alert-dialog as the
      a11y base) restyled to match Streamdown's linkSafety modal exactly:
      rounded-xl card (p-6, gap-4, max-w-md), top-right X close, header
      icon + "Open external link?", warning line, mono URL box
      (`bg-muted p-3`, max-h-32 scroll), Copy link (outline + "Copied"
      feedback via `copyTextToClipboard`) + Open link (primary) —
      `window.open(url, "_blank", "noreferrer")` on confirm.
    - Tests: row click toggles, title click opens dialog (not navigation),
      confirm opens the URL, keyboard/focus, running/interrupted states
      unchanged.

19. **Inline source citations (R14)**
    - `tool.ts`: per-request shared counter in `buildSearchTools`; stamp
      `num` on each served `searchWeb` result and on the `fetchPage`
      output; extend tool output types/zod + persisted-part consumers
      accordingly (additive field, old rows without `num` simply have no
      resolvable citations).
    - Instructions: append the citation directive wherever tool-mode
      instructions are assembled (both routes share the helper); keep it
      inside `toolTurnStepSettings`' forced-step override.
    - `MessageItem.tsx`: build the message's `num → source` map from tool
      parts; pass to `Markdown` as `citations`.
    - `Markdown.tsx`: optional `citations` prop; AST-level `[n]` →
      citation-chip transform (code/inline-code excluded); chip =
      superscript button opening `ExternalLinkDialog`. Verify Streamdown's
      extension points (custom components / remark plugin hooks) before
      choosing the mechanism; keep plugin identity stable (memo
      comparator!) and keep the no-citations path byte-identical.
    - Tests: num uniqueness across calls; directive present + retained on
      forced step; chip rendering for resolvable markers; literal
      passthrough for out-of-range/no-source/code-span markers; chip
      click opens the dialog with the right URL; streaming + reload.

## Acceptance additions (R10–R12)

- Brave adapter calls `/res/v1/llm/context` with the documented budgets and
  maps extracted chunks into results.
- With Exa (or Tavily/Firecrawl) configured, the model can call `fetchPage`
  on a search-result URL and receives page content (≤8000 chars,
  `truncated` flagged) in the same turn.
- With only Brave configured, `fetchPage` is absent from the tool list.
- A `fetchPage` block renders collapsed with title/domain + provider badge;
  expanding shows a preview; works live and after reload.
- Step budget remains 5; forced-answer step and markup sanitization behave
  identically for both tools.

## Validation Commands

- `pnpm lint && pnpm typecheck`
- `pnpm test` (unit + integration; integration needs the test DB per
  `vitest.integration.setup.ts`)

## Risky Files / Rollback Points

- `src/components/chat/MessageItem.tsx` — rendering refactor touches every
  message; its test suite must pass unchanged plus new cases.
- `src/app/api/chat/route.ts` and the regenerate route — streaming pipeline;
  keep diffs minimal and additive.
- Migration is additive; rollback = revert + `DROP TABLE search_provider_settings`.

## Follow-up Checks Before `task.py start`

- Confirm the four providers' current API docs (endpoints, auth headers,
  response shapes) — update `design.md` if any drifted.
- Confirm `stepCountIs` export name in `ai@7` when wiring `stopWhen`.
