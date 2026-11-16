# Implement: message token usage stats

## Checklist (in order)

1. Schema contract — `src/lib/schemas/chat.ts`: add `chatUsageSchema`,
   `usage` on `chatMetadataSchema`, remove `totalTokens`.
2. DB — `src/server/db/schema/chat.ts`: `usage: jsonb("usage").$type<ChatUsage>()`,
   remove `totalTokens`. `pnpm db:generate`, then hand-edit the SQL to
   add → backfill → drop (design.md "Persistence"). `pnpm db:migrate`.
3. Service — `src/server/services/message.service.ts`: `metadataFromRow`,
   insert/update inputs (`:478`, `:587`, `:660`) use `usage`.
4. Runner — `src/server/ai/generation-runner.ts:396-445`: checkpoint content
   and `persistedMetadataOf` carry `usage`.
5. Capture — `src/server/ai/generation-turn.ts`: `onLanguageModelCallEnd`
   accumulator + raw cache fallback schema; finish `messageMetadata` emits
   `usage`.
6. Fix any other `totalTokens` references the typechecker surfaces
   (tests, `src/test-utils/generation-harness.ts`).
7. UI — `src/components/chat/MessageUsage.tsx` + model-row layout in
   `MessageItem.tsx:763`; i18n keys in `messages/en.json`, `messages/zh-CN.json`.
8. Tests — extend existing ones only:
   - `message.service` metadata round-trip for `usage`.
   - generation integration harness: finish metadata contains `usage`
     with `outputMs` from call performance and the raw cache fallback.
   - `MessageItem.test.tsx`: stats render with usage, absent without
     (legacy/stopped), accessible trigger name.
9. Spec — update `.trellis/spec/backend/chat-message-metadata.md` (usage
   jsonb, `totalTokens` removal, `onLanguageModelCallEnd` capture rule).

## Validation

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm db:migrate   # against a DB with existing messages
```

Manual: run the app, send one plain turn and one search-tool turn on each
available format; check desktop and mobile widths, reload, hover/tap.

## Risky points

- The migration (step 2) — verify the backfill SQL before drop.
- `messageMetadata` replace semantics: the runner overrides finish metadata
  with the accumulated state (`generation-runner.ts:614-622`); confirm
  `usage` survives that merge.
