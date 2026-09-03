# Implementation Plan — Model metadata and vendor icons

Branch off current `main` (or the user’s working branch if this lands with
other WIP). Each step leaves lint and types clean.

## Ordered checklist

1. **Schema + migration.** Metadata columns on `provider_models` as in
   `design.md`. `pnpm db:generate`; apply from empty.
   → AC1

2. **Zod contracts.** Extend `providerModelSchema` / `availableModelSchema`;
   add `updateProviderModelSchema`; add optional `reasoningEffort` on
   `chatRequestSchema`. Shared types only — no parallel interfaces.

3. **`model-catalog.ts`.** Fetch, cache, match, map. Unit tests with stubbed
   `fetch` (hit, suffix, miss, timeout, non-JSON).
   → AC2, AC3

4. **`model-vendor.ts` + SVGs + `ModelVendorIcon`.** Heuristic + generic
   fallback. Unit-test the heuristic table.

5. **Service: add fills, PATCH, lazy fill.** `addProviderModel` writes lookup
   or D2 defaults. `updateProviderModel` owner-only; `resetFromCatalog`
   ignores `user` lock only when the flag is set. List/resolution fills NULL
   `metadata_source` and persists. Integration tests.
   → AC2, AC4, AC5, AC8

6. **Routes.** PATCH on `/api/providers/[id]/models`. `GET /api/models` and
   provider list responses include metadata via the existing handlers (schema
   change only if they already return mapped rows).

7. **Settings UI.** Icon on chips; owner dialog to edit fields and reset from
   catalog; shared cards read-only with icon. Both breakpoints.
   → AC6, AC8

8. **Picker + composer effort.** AvailableModel drives cues and the Auto +
   stored-options switch. Zustand effort; reset on model change. Chat send
   body includes effort only when not Auto.
   → AC6, AC7

9. **Chat stream + thinking UI.** `sendReasoning: true`; validate effort
   against the resolved row; `providerOptions.openaiCompatible`.
   `ReasoningBlock` auto-open/auto-collapse; MessageItem tests.
   → AC7, AC9

10. **Full pass.** `pnpm lint`, `pnpm typecheck`, `pnpm test`. Browser: add a
    known id (gpt-4o or similar), add a fake local id (defaults), edit, pick
    in composer, stream a reasoning model, confirm collapse. Mobile composer
    effort control reachable.
    → AC10

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate   # no extra diff after step 1
```

## Risky files / rollback

- `src/app/api/chat/route.ts` — `sendReasoning` change affects every turn;
  keep persistence of reasoning parts compatible with
  `convertToModelMessages`.
- `provider_models` migration — additive; rollback is leave columns unused,
  not drop from a live DB in the same deploy.
- Catalog `fetch` — must be stubbed in tests; a leaked real GET would make
  CI depend on models.dev.

## Follow-up before `task.py start`

- `implement.jsonl` / `check.jsonl` curated (spec + this research).
- Planning summary approved by the user.

## Iteration log (user review rounds, branch feat/model-metadata)

Documented here per workflow: task docs first, then code. Round 1–2 landed
before this log existed; their decisions are backfilled into prd.md and
design.md.

1. **Round 1 — implemented.** Thinking block full width + whole-row toggle
   (AC9); catalog tie-break by heuristic vendor + zhipu coding-plan aliases
   (design.md Catalog fill); `formatContextTokens` → `string | null` with
   `1M` rounding and hidden labels below 1M; vision/reasoning cues as icons
   (AC6). Tests: model-catalog tie-break, model-vendor formatter + aliases,
   ModelPicker cues.
2. **Round 2 — implemented.** Vision cue icon; reasoning stream auto-follow
   (design.md Thinking block bullets; AC9). Tests: ReasoningBlock 4 cases,
   ModelPicker icon cues.
3. **Round 3 — pending approval.** R10 / AC11: `positionMethod="fixed"` on
   the shared `ui/popover.tsx`, `ui/select.tsx`, `ui/dropdown-menu.tsx`,
   `ui/tooltip.tsx` Positioners so portal popups never create document
   scroll. Validate: unit suite green; browser-measure that opening the
   picker and the effort select on the composer leaves
   `documentElement.scrollHeight` unchanged, and popups still track the
   trigger on a document-scrolled page (settings).
