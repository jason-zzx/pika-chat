# Add i18n support (default en, add zh-CN)

> Parent task. Owns the requirement set, the child task map, cross-child (integration) acceptance criteria, and the final integration review. Implementation happens in the child tasks.

## Goal

Make the entire user-facing UI translatable and add Chinese (Simplified) as a second locale, so Chinese-speaking users can operate the self-hosted app in their language. English stays the source and default language. The architecture must allow adding more locales later without rework.

## Background / Confirmed facts (from repository inspection, 2026-09-10)

- UI copy is hardcoded English across ~100 component `.tsx` files (e.g. `src/components/chat/Composer.tsx`, `src/components/admin/AdminUsersScreen.tsx`, `src/components/auth/*`). No i18n library is installed (`package.json`).
- `<html lang="en">` is static in `src/app/layout.tsx:36`.
- No `middleware.ts` exists; routes are not locale-prefixed. Route groups: `src/app/(app)` and `src/app/(auth)`.
- Precedent for per-browser preference: theme uses a cookie (`pika_theme`) parsed in the root layout (`src/lib/theme.ts`, `src/app/layout.tsx:30`), with a control on the General settings page (`src/app/(app)/settings/general/page.tsx`, `src/components/layout/ThemeControl.tsx`).
- Error contract: services throw `AppError(code, status, message, details)` (`src/server/errors.ts`); `withErrorHandling` serializes `{ error: { code, message, details } }` (`src/app/api/_lib/with-error-handling.ts`); clients display `message` via `apiErrorMessage(error, fallback)` (`src/lib/api/error-message.ts`). ~73 `new AppError(` call sites across ~24 files; some messages are interpolated (e.g. provider errors).
- `.trellis/spec/backend/error-handling.md` already declares: "`code` is the contract … messages get reworded and localized; clients branch on `code`, never on `message`." Current client code does not follow this yet.
- i18n-relevant surfaces: ~53 client components, ~100 component files, settings pages, auth pages, admin screens, relative timestamps (`src/components/chat/MessageTimestamp.tsx`, `src/lib/message-time.ts`), `metadata` in `src/app/layout.tsx:22`.
- Tests: ~76 Vitest files; several assert on English UI copy (`@testing-library`).

## Key decisions (user-confirmed)

- D1 (2026-09-10): Locale set = `en` (default) + `zh-CN`. Resolution chain: `NEXT_LOCALE` cookie → `Accept-Language` → `en`.
- D2 (2026-09-10): Scope = full migration (infrastructure + all screens + server error localization + regression guard), delivered as this parent task plus independently verifiable child tasks.

## Requirements

- R1 Locale infrastructure: locale resolution per request from a `NEXT_LOCALE` cookie, falling back to `Accept-Language`, defaulting to `en`. No locale prefix in URLs.
- R2 Language switcher on Settings → General, next to Theme; switching updates the UI immediately and persists in the cookie (same pattern as theme).
- R3 All user-facing UI strings move to message catalogs (`en` source + `zh-CN` translation), organized in namespaces; type-safe message keys.
- R4 `lang` attribute on `<html>` reflects the active locale.
- R5 Server error messages become localizable on the client: server keeps stable machine-readable codes (+ params), the client maps them to localized text. Server-side logging stays English.
- R6 Dates / relative times render in the active locale via `Intl`.
- R7 Regression guard: new hardcoded user-facing strings are caught by lint.
- R8 Existing tests updated to remain green; i18n-aware tests render with a locale provider.

## Task map (parent / child)

Each child owns an independently verifiable deliverable. Ordering below is authoritative (dependency, not tree position).

| Child task | Deliverable | Ordering |
|---|---|---|
| `i18n-core` | next-intl integration (cookie-based, no URL prefix), locale resolution, root-layout provider, dynamic `<html lang>`, Settings→General language switcher, layout/common reference slice, **server error localization** (`AppError` → stable keys + params, client mapping), i18n spec doc written | start first |
| `i18n-ui` | All remaining screens migrated in batches (auth/account → chat incl. Intl timestamps → settings/admin/provider/search); tests updated; no raw English remnants | after `i18n-core` |
| `i18n-guard` | ESLint regression guard for hardcoded user-facing strings; final repo-wide sweep; spec complete; parent AC1–AC8 verified with evidence | last |

## Cross-child acceptance criteria (verified at parent level on the integrated result)

> Status 2026-09-10: **all verified** — headless evidence in `../09-10-i18n-guard/verification.md` (archived with that task) and the browser acceptance in `acceptance-2026-09-10/report.md`.

- [x] AC1 With locale `zh-CN`, all primary screens (sign-in/up, setup, chat, topics, settings, providers, admin, account) show Chinese copy; switching back to `en` shows English without a page reload.
- [x] AC2 Locale choice persists across page reloads and navigation (cookie), without changing the URL.
- [x] AC3 A fresh browser with `Accept-Language: zh-CN` gets Chinese; unsupported/absent headers fall back to English.
- [x] AC4 `<html lang>` matches the active locale.
- [x] AC5 A failing API call (e.g. duplicate username, invalid provider key) shows a localized error message, not the raw English server message.
- [x] AC6 Relative timestamps follow the active locale.
- [x] AC7 `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.
- [x] AC8 Adding a new locale requires only adding one catalog file + registering the locale (no component edits).

## Out of scope

- Locale-prefixed URLs (`/en/...`) and SEO alternates.
- RTL layout support.
- More than `en` + `zh-CN` in this effort (structure must allow more later).
- Localizing user-generated content (topic titles, assistant names) or LLM output.
- Localizing server logs / log-only error text.
- Per-user locale stored in DB (cross-device sync); uses a per-browser cookie like theme.
