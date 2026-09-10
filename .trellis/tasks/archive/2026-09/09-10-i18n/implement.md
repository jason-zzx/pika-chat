# Execution plan — i18n effort (parent)

This is the coordination-level plan. Each child task owns its detailed `implement.md`; this file defines ordering, per-child gates, integration verification, and rollback shape.

## Ordered checklist

1. **`i18n-core`** (start first) — locale infrastructure + General-page reference slice + server error localization + `.trellis/spec/frontend/i18n.md`. Runs as two commit batches (A: infrastructure, B: error contract).
   Gate: PRD ACs pass; `i18n-ui` can follow the spec without questions.
2. **`i18n-ui`** — all remaining screens in ordered batches (auth/account → chat → settings/admin/provider/search → timestamps). One task, sequential batches, commit per batch — sequential execution avoids catalog merge conflicts and repetitive test-wrapper churn.
   Gate: screens show no English remnants in `zh-CN`; tests green.
3. **`i18n-guard`** (start last) — lint guard + repo-wide sweep + parent AC verification (AC1–AC8) with recorded evidence.

## Validation commands (every child)

```bash
pnpm lint
pnpm typecheck
pnpm test
```

For UI work, additionally: `pnpm dev` and manually verify the migrated screens in both `en` and `zh-CN` (switch on Settings → General).

## Per-child done criteria

- Child PRD acceptance criteria all checked.
- No hardcoded user-facing strings in the child's file scope (verified by inspection until `i18n-guard` lands).
- Catalogs updated in both locales for the child's namespaces; no orphan keys (key present in `en` must exist in `zh-CN`).
- Tests updated and green.

## Integration verification (parent, done by `i18n-guard`)

- Parent AC1–AC8, including the full manual pass over: sign-in/up, setup, chat (compose, stream, stop, regenerate, tools, citations), topics (rename/delete), settings (general/account/providers/search/users), admin, account password change.
- Error-path spot checks: duplicate username, invalid provider key, 404 topic, rate limit, validation failure.
- `pnpm build` sanity (standalone Docker config untouched).

## Risky files / rollback points

| Area | Risk | Rollback |
|---|---|---|
| `src/app/layout.tsx` | Every route depends on it (locale provider, `lang`, metadata) | Batch A of `i18n-core`; layout is self-contained |
| API error envelope (`with-error-handling.ts`, `errors.ts`) | Contract change across ~24 files; partial application would break clients | Batch B of `i18n-core` — atomic across server + client + tests; revert the batch on failure |
| Catalog files | Merge conflicts / orphan keys while migrating | Single catalog per locale + sequential batches; orphan-key check in `i18n-guard` |
| Root layout cookie read | Async `cookies()` behavior changes across Next versions | Covered by `i18n-core` tests + build check |

## Working agreements

- One child = one branch/PR-sized change; archive child tasks in order.
- Catalog layout and key naming fixed by `design.md`; children must not rename established keys.
- `zh-CN` entries are written by the migrating child, not deferred.
- If a child discovers the design is wrong, stop and return to planning (fix `design.md` at parent level) instead of improvising.
