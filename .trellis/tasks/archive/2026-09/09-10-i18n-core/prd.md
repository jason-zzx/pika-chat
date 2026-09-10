# i18n core: locale infrastructure + server error localization

> Child of `09-10-i18n`. Parent PRD holds the master requirements (R1–R8). **Start this child first** — `i18n-ui` depends on it.

## Goal / deliverable

Two coupled pieces of platform work that everything else builds on:

1. Working locale infrastructure (cookie-based, no URL prefix) plus an end-to-end reference slice: Settings → General and the layout/common components render from catalogs in `en` / `zh-CN`, with a language switcher that changes the UI immediately and persists the choice.
2. Server errors stop shipping human-readable English: services throw stable message keys (+ params), the client resolves them to localized text.

## In scope

**Locale infrastructure**

- Add the i18n library (setup per `research/next-intl-setup.md`, pinned `next-intl@4.14.2`).
- Locale resolution: `NEXT_LOCALE` cookie → `Accept-Language` → `en`, mirroring the `pika_theme` cookie pattern in `src/lib/theme.ts`.
- Root layout (`src/app/layout.tsx`): locale provider, dynamic `<html lang>`, localized `metadata` via `generateMetadata`.
- Language switcher on `src/app/(app)/settings/general/page.tsx` next to `ThemeControl`; immediate switch + cookie persistence (no reload), via a Server Action.
- Catalog skeleton (`en` source, `zh-CN` translation) with namespaces for the migrated slice; type-safe keys configured.
- Migrate copy in: `settings/general/page.tsx`, `components/layout/*` with user-facing strings (AppSidebar, SettingsNav, SidebarUserMenu, InsetHeader, PageHeader, ThemeControl if any), `components/common/EmptyState.tsx`, `components/ui/*` primitives carrying user-facing strings (sidebar, dialog, sheet).
- Write `.trellis/spec/frontend/i18n.md` documenting the conventions all later work must follow (catalog layout, namespace rules, server/client usage, testing wrapper, error-key conventions).

**Server error localization (R5)**

- `src/server/errors.ts`: `AppError` carries `messageKey` + `params` instead of a display `message` (key type derived from the `Errors` catalog; `code`/`status`/`details` unchanged).
- `src/app/api/_lib/with-error-handling.ts`: envelope becomes `{ error: { code, messageKey, params?, details? } }`; Zod errors map to stable keys (`validation.*`) with per-field `{ key, params? }` in `details`.
- All ~73 `new AppError(` sites (~24 files): message strings → catalog-backed keys, interpolated values → params. Server logs stay English.
- Client: `apiErrorMessage(error, t, fallbackKey)` resolves via `t.has` with a generic localized fallback; all ~30 call sites updated (they live in components migrated later by `i18n-ui` — the pattern must be finished here).
- Streaming path audited (`chat/route.ts`, `chat/stop/route.ts`, `provider-error.ts`): our wrapper copy becomes keys; third-party provider detail stays verbatim.
- Tests asserting error text updated (`errors.test.ts`, service/integration tests).

## Out of scope

- All remaining screens' copy (owned by `i18n-ui`).
- The ESLint regression guard (`i18n-guard`).
- Localizing server logs / provider-supplied text.

## Dependencies

- None (start first). Must not start before the research files exist (done at parent planning time).

## Acceptance criteria

- [ ] Switching locale on Settings → General re-renders page + shell/sidebar copy in the chosen language without a reload; switching back restores English.
- [ ] Choice persists across reloads/navigation via `NEXT_LOCALE`; URL unchanged.
- [ ] Fresh browser: `Accept-Language: zh-CN` yields Chinese; unknown/absent header yields English.
- [ ] `<html lang>` matches the active locale; localized title/description.
- [ ] No hardcoded user-facing strings remain in the migrated files.
- [ ] No API response contains user-facing English error text; responses carry stable `messageKey` (+ params).
- [ ] With `zh-CN`, representative failures (duplicate username, invalid provider key, topic not found, validation failure with field errors) display Chinese messages; unknown key falls back to a generic localized message.
- [ ] Server logs remain English and keep correlation ids; provider-supplied detail stays verbatim.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; touched tests render with the locale provider.
- [ ] `.trellis/spec/frontend/i18n.md` exists and is sufficient for a sibling child to migrate a screen without asking questions.
