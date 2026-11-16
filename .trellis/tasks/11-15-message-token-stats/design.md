# Design: message token usage stats

## Contract

`chatMetadataSchema` (`src/lib/schemas/chat.ts`) replaces top-level
`totalTokens` with:

```ts
usage: z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  ttftMs: z.number().int().nonnegative().optional(),
  outputMs: z.number().int().nonnegative().optional(),
}).optional()
```

The same schema types the `chat_messages.usage` jsonb column
(`$type<ChatUsage>()`). Only raw facts are stored; TPS and hit rate are
derived in the UI. Removing `totalTokens` narrows the metadata contract on
purpose (no consumer reads it; user approved merging it); the spec
`chat-message-metadata.md` is updated to say so.

## Capture (generation-turn.ts)

- `streamText({ onLanguageModelCallEnd })` fires once per model call,
  **before** client-side tool execution, with per-call `usage` (including
  `raw`) and `performance.{responseTimeMs, timeToFirstOutputMs}`.
  Accumulate into a turn-local object:
  - `outputMs += responseTimeMs - (timeToFirstOutputMs ?? responseTimeMs)`
  - per-call cache hit: claude/google → `usage.inputTokenDetails.cacheReadTokens`;
    openai-compatible → raw via a zod schema at this boundary
    (`prompt_tokens_details.cached_tokens` ?? `prompt_cache_hit_tokens` ??
    `cached_tokens`, all optional; `safeParse` failure or none present →
    `undefined`). The SDK value is not used for openai-compatible because it
    defaults a missing field to 0.
  - `ttftMs ??= performance.timeToFirstOutputMs` (rounded on emit): the
    first call that reports a TTFT wins; later calls never overwrite it.
  - `cacheReadTokens` stays `undefined` until a call reports a number, then
    sums reported values.
- The finish `messageMetadata` builds `usage` from `part.totalUsage`
  (input/output/total/cacheWrite) plus the accumulated `cacheReadTokens`,
  `outputMs`, and `durationMs = Date.now() - turnStartMs` (`turnStartMs` is
  taken when the text turn starts executing, not the row's `createdAt`).
- No early `message-metadata` emit carries usage, so `liveMetadata()` is
  unchanged (finish-only field, see out of scope).

Why not a custom timer in `onChunk`: the SDK already measures per-call TTFT
and response time and excludes tool execution; reproducing it would need
step-boundary tracking that `onChunk` does not see.

## Persistence

- Drizzle: add `usage jsonb` (nullable) to `chat_messages`, remove
  `totalTokens`. Hand-edit the generated migration so the order is
  add column → `UPDATE chat_messages SET usage = jsonb_build_object('totalTokens', total_tokens) WHERE total_tokens IS NOT NULL` → drop column.
- `persistedMetadataOf` / checkpoint content (`generation-runner.ts:396-445`)
  carry `usage` instead of `totalTokens`.
- `message.service.ts`: `metadataFromRow`, `insert`/`update` inputs swap
  `totalTokens` for `usage`.
- Restart recovery and stopped/failed finalization carry no usage (no
  finish chunk) → column stays null.

## UI

- `MessageItem.tsx:763`: model row becomes
  `<div className="flex items-center gap-2 text-xs text-muted-foreground">`
  with `modelId` left and `<MessageUsage usage={metadata.usage} />` pushed
  right (`ml-auto`). Render `MessageUsage` only when `usage.outputTokens`
  is defined (legacy backfilled rows carry only `totalTokens`, so they stay
  hidden).
- `MessageUsage` (new, `src/components/chat/MessageUsage.tsx`): a Base UI
  `Popover` whose `PopoverTrigger` is a borderless button with
  `openOnHover` (hover on pointer devices, click/tap everywhere). Trigger
  content: `<span className="hidden md:inline">↑{in} ↓{out} · </span>{tps} tok/s`.
  The popup lists the rows from R7 in a two-column grid; the cache and
  hit-rate rows render only when `cacheReadTokens` is defined (hit rate also
  needs `inputTokens > 0`).
- Formatting via `Intl.NumberFormat(locale, { notation: "compact" })` inline
  and default grouping in the card; TPS one decimal; duration `x.xs`; hit
  rate whole percent.
- Strings in `messages/en.json` + `messages/zh-CN.json` under the existing
  chat message namespace; trigger gets an `aria-label`.
- Popup positioning uses the shared `popover.tsx` (already
  `positionMethod="fixed"`); no edits to `components/ui/`.

## Format notes

| | openai-compatible | claude | google |
|---|---|---|---|
| cacheRead source | raw: `prompt_tokens_details.cached_tokens` → `prompt_cache_hit_tokens` → `cached_tokens`; none → unreported | `cache_read_input_tokens` | `cachedContentTokenCount` (absent → 0) |
| cacheWrite | — | `cache_creation_input_tokens` | — |
| Usage may be absent | yes (proxy ignores `include_usage`) → no stats | no | no |

Known inaccuracies, accepted: provider-executed builtin search runs inside a
model call, so its server-side time stays in `outputMs`; coarse Gemini
chunking can make `outputMs` tiny (TPS hidden at 0); Gemini's
omitted cache field is read as 0 hits.

## Rollback

Single migration + code revert. Rolling back after the migration loses the
backfilled `totalTokens` only if the down path is not written; since no UI
reads it, a revert migration re-adding `total_tokens` from `usage->>'totalTokens'`
is sufficient.
