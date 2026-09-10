# Implement plan — i18n-guard

Read order: `prd.md` → `design.md` (this dir) → parent `../09-10-i18n/design.md` §9 → `../09-10-i18n/research/lint-guard.md` → `.trellis/spec/frontend/i18n.md`.

No git commits — leave everything in the working tree; the main session commits after review.

## Steps

1. `pnpm add -D eslint-plugin-i18next@6.1.5`.
2. `eslint.config.mjs`: import the plugin; add `i18next.configs["flat/recommended"]`; add the calibrated block per `design.md` (`src/**/*.{ts,tsx}`, `mode: "jsx-only"`, attribute excludes); turn the rule off for `src/**/*.test.ts(x)`; add file-scoped allowlists only with a reason comment.
3. `pnpm lint` — triage every violation:
   - real user-facing copy → migrate to catalogs (en + zh in the same change, existing namespaces);
   - non-copy literals (vendor/proper nouns, generated primitives) → attribute exclude or file allowlist with reason.
   Iterate until `pnpm lint` is clean.
4. Guard demonstration: temporarily add a hardcoded JSX string to a component, run `pnpm lint` (must fail with `i18next/no-literal-string`), capture the output, then revert the edit (tree must be clean for that file).
5. `.trellis/spec/frontend/i18n.md`: add a "Regression guard" section (rule, config, allowlist policy, accepted ALL-CAPS gap) and an "Adding a locale" section with the exact steps from `design.md` §Locale extensibility.
6. AC8 dry-run: perform the steps for a throwaway locale (e.g. `ja`) until `pnpm typecheck`/`pnpm test` guide you through the required registration points; record what broke/needed updating; revert everything.
7. Integrated verification per `design.md` §Integrated verification: full gate, standalone smoke in both locales, error-envelope check; write `verification.md` in this task dir with commands and observed results, plus the manual browser checklist.
8. Report: files changed, commands + results, the allowlist entries with reasons, and anything left manual.

## Risky files

- `eslint.config.mjs` — repo-wide lint behavior; keep the diff minimal and readable.
- `.trellis/spec/frontend/i18n.md` — the conventions source of truth for future work.
- Any component edited during the sweep — copy-only, no behavior change.
