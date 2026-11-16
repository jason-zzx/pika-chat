# Message token usage stats

## Goal

Let users see, per assistant answer, how many tokens the turn consumed, how
much of the prompt was served from cache, and how fast the model produced
output — without leaving the chat. The stats sit at the right end of the
model-name row under every assistant message.

## Background (confirmed facts)

- The model row today is a bare `<p>{modelId}</p>` at
  `src/components/chat/MessageItem.tsx:763`.
- Only `totalTokens` is captured from usage (`src/server/ai/generation-turn.ts:795`)
  and persisted in `chat_messages.total_tokens`
  (`src/server/db/schema/chat.ts:50`); no UI reads it.
- AI SDK 7 normalizes usage across all three `apiFormat`s: `inputTokens` is
  the full prompt including cached tokens for openai-compatible, claude
  (SDK adds `cache_read` + `cache_creation` back) and google. `outputTokens`
  includes reasoning/thinking tokens for all three.
- `cacheWriteTokens` exists only for claude.
- The openai-compatible adapter only maps `prompt_tokens_details.cached_tokens`
  and defaults a missing field to 0, so "unreported" and "0 hits" are
  indistinguishable from the SDK value. DeepSeek reports
  `prompt_cache_hit_tokens`, Moonshot/Kimi a top-level `cached_tokens`.
- `handle.apiFormat` is available in the generation turn.
- Multi-step (search tool) turns: `totalUsage` sums steps but drops `raw`
  (`node_modules/ai/dist/index.js:2313`).

## Requirements

- R1 Capture per answer: input tokens, output tokens, cache-read tokens,
  total duration, and output-generation time. Persist them so live, resumed
  and reloaded views show the same values.
- R2 "Cache" means cache-hit (read) tokens; hit rate = cache-hit tokens /
  total input tokens (input already includes cached tokens on every format).
  Per model call, claude/google use the SDK value (Gemini omits the field on
  no hit → 0). openai-compatible reads raw usage in order
  `prompt_tokens_details.cached_tokens` → `prompt_cache_hit_tokens`
  (DeepSeek) → top-level `cached_tokens` (Kimi); none present = unreported.
  Turn value = sum of reported calls; unreported when no call reported.
- R3 TPS = output tokens / output-generation time, where output-generation
  time sums, over every model call in the turn, the span from first output
  chunk to that call's end. Client-side tool execution and time-to-first-token
  are excluded. (Decision: user-approved.)
- R4 Total duration = wall clock from the start of the generation turn
  execution (not the placeholder row's admission time, so queueing before
  execution is excluded) to finish, including TTFT and tool execution.
  (Decision: user-approved.)
- R4b Time to first token (TTFT) = the first model call's
  `performance.timeToFirstOutputMs` (request sent → first output chunk,
  reasoning chunks included), matching the industry TTFT definition.
  Later calls of a multi-step turn do not change it, except that when the
  first call produced no output chunk at all, the first call that did
  provides it. (Decision: user-approved, added after initial implementation.)
- R5 Storage: one `usage` jsonb column replaces `total_tokens`; existing
  `total_tokens` values are backfilled into it. (Decision: user-approved.)
- R6 Desktop (`md` and up) model row right side: input tokens, output
  tokens, TPS. Mobile: TPS only.
  When TPS is unavailable, mobile falls back to `↑in ↓out` so the trigger
  is never empty. (Decision: user-approved.)
- R7 Hover (desktop) or tap (mobile) opens a popover card with: input
  tokens, output tokens, cache-hit tokens, cache hit rate, TPS, TTFT, total
  duration. TTFT is card-only (not on the inline trigger). When cache is unreported, the cache and hit-rate rows are not
  rendered. (Decision: user-approved, replaces showing 0.)
- R8 Inline numbers are compact (`1.2k`); the popover shows full locale-
  grouped numbers. All copy goes through the en / zh-CN catalogs.

## Acceptance Criteria

- [ ] AC1 (R1, R6) A completed answer shows `↑in ↓out · N tok/s` at the right
      end of its model row on desktop, `N tok/s` on mobile.
- [ ] AC2 (R1) After a page reload or a stream reconnect, the same values appear.
- [ ] AC3 (R7) Hovering on desktop / tapping on mobile opens the card with
      all six values; Escape / tapping outside closes it.
- [ ] AC3b (R4b) The card shows TTFT (e.g. `0.8s`); a turn whose first call
      reports no TTFT shows `—`; reload shows the same value.
- [ ] AC4 (R3) A search-tool turn's TPS does not drop by the tool's execution
      time (TPS computed from per-call output time only).
- [ ] AC5 (R2) An openai-compatible response whose raw usage carries
      `prompt_cache_hit_tokens` or top-level `cached_tokens` shows that value
      as cache-hit tokens and a matching hit rate.
- [ ] AC5b (R2, R7) An openai-compatible response with none of the three
      cache fields shows no cache and no hit-rate row; a claude/google
      response without hits shows `0` and `0%`.
- [ ] AC6 Stopped, failed, recovered-after-restart, image-generation and
      legacy (pre-migration) answers render the model row exactly as today, with no
      stats and no empty trigger.
- [ ] AC7 TPS is hidden when output time is 0 / unknown; hit rate is hidden
      when input tokens are 0 / unknown; any other missing field shows `—`.
- [ ] AC8 (R5) Migration adds `usage`, backfills `{ totalTokens }` from
      `total_tokens`, drops `total_tokens`; `pnpm db:migrate` succeeds on a
      database with existing messages.
- [ ] AC9 `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.

## Out of Scope

- Live (mid-stream) token/TPS display — stats appear on finish only.
- Monetary cost estimates.
- Cache-write tokens and reasoning-token breakdown in the UI (cache-write is
  stored for claude but not displayed).
- Aggregated per-topic or per-user usage.
- Usage for stopped/failed turns (no `finish` event carries usage).
