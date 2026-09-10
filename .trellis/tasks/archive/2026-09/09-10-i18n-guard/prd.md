# i18n regression guard + integrated verification

> Child of `09-10-i18n`. Depends on `i18n-core` and `i18n-ui` (both merged and green). Start last.

## Goal / deliverable

Hardcoded user-facing strings can no longer regress: lint fails on new ones, the repo is swept clean, the i18n spec is complete, and parent AC1–AC8 are verified on the integrated result with recorded evidence.

## In scope

- ESLint (flat config `eslint.config.mjs`) rule that flags hardcoded user-facing string literals in JSX/TSX, with a documented allowlist mechanism (proper nouns, test ids, class names, `en` catalog itself).
- Repo-wide sweep: fix/allowlist every remaining violation outside already-migrated scopes.
- Finalize `.trellis/spec/frontend/i18n.md` (created by `i18n-core`) with the guard rule + how to add a locale.
- Verify parent acceptance AC1–AC8 on the integrated result and record evidence (commands + observed output summary) in this task.

## Out of scope

- Backend non-error strings (logs, comments).

## Acceptance criteria

- [ ] `pnpm lint` fails when a hardcoded user-facing string is added to a component (demonstrated).
- [ ] Repo-wide lint/typecheck/tests pass with the rule enabled.
- [ ] Adding a new locale requires only a catalog file + locale registration (parent AC8) — verified by a dry-run or documented check.
- [ ] Integrated manual pass: all primary screens in `zh-CN` and `en`; acceptance evidence recorded (including error paths and `pnpm build` sanity).
- [ ] `.trellis/spec/frontend/i18n.md` complete.
