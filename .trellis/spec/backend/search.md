# Topic & Message Search

> Cross-layer contract for the sidebar full-text search over the user's own
> topic titles and message text. Landed with `09-29-topic-message-search`.

## Scope / Trigger

Any work touching `GET /api/search`, `search.service.ts`, the sidebar search
UI, or the `?m=` message-anchor navigation.

## Contracts

- **Ownership**: both queries filter by `assistants.ownerId = actor.userId`
  in the WHERE clause (topics join assistants directly; messages join
  topics + assistants). No fetch-then-check.
- **Matching is ILIKE with literal semantics**: `%`, `_`, and `\` are escaped
  (`escapeIlike`), so user input never acts as a wildcard. Postgres
  `standard_conforming_strings=on` + drizzle parameter binding make this
  safe; do not switch to `parts::text` matching — JSON keys are English and
  would false-positive on Latin queries.
- **Message match scope**: `jsonb_array_elements(parts)` where
  `p->>'type' = 'text'`; reasoning, tool payloads, and attachment text are
  deliberately excluded. Only `is_selected = true` rows match — an
  unselected version's content is not what the user sees when they land.
- **Snippet is app-side**: the SQL returns `parts` for the ≤20 hit rows and
  `uiPartsFromJson` + the shared `windowAroundMatch` (exported from
  `src/lib/schemas/search.ts` alongside `SNIPPET_*` / `TITLE_*`) reproduce
  the same text-part scope in TypeScript. If the SQL match clause changes,
  the extraction filter must change with it (they are two implementations
  of one contract).
- Result caps: 20 topics (`updatedAt desc`) + 20 messages
  (`createdAt desc`). Empty `q` (after trim) is a 200 with empty groups,
  not a validation error. `q` is truncated at `SEARCH_QUERY_MAX_LENGTH`.
- **Navigation anchor**: message hits link to
  `/assistant/{assistantId}/{topicId}?m={groupId}`. `ChatView` consumes `m`
  once per (topic, key) — scroll + 2s highlight, then `router.replace`
  strips it. The consumption guard re-arms when the param is absent, so a
  repeat click on the same result works; do not make the guard one-shot
  per mount.
- Highlight styling (the `?m=` row flash and the result `<mark>`) uses
  `--primary` tints rather than a dedicated color family; the token contract
  lives in
  [frontend/theming.md](../frontend/theming.md) and
  [frontend/component-guidelines.md](../frontend/component-guidelines.md).
- The search dependency on **unpaginated message history** is load-bearing
  for navigation: `scrollToMessage` can only find rows that rendered. If
  message pagination is ever introduced, search navigation must be
  revisited.

## Tests Required

Integration (real DB): hit matching on both groups, cross-user isolation,
literal `%`/`_` queries, exact snippet window, unselected-version and
non-text-part exclusion. See `search.service.integration.test.ts`.
