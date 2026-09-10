# Design — i18n core (infrastructure + server error localization)

> Conforms to the parent design (`../09-10-i18n/design.md`, §1–5, §7–10). This file records file-level decisions specific to this child.

## Part A — locale infrastructure

### Files

New:

- `messages/en.json`, `messages/zh-CN.json` — catalogs with namespaces `RootLayout`, `Layout`, `Common`, `Settings.General` + the `Errors` / `Validation` sections from Part B (single file per locale; parent design §3).
- `src/i18n/locales.ts` — `locales`, `Locale`, `DEFAULT_LOCALE`, `LOCALE_COOKIE_NAME`, `LOCALE_LABELS`, exported `matchAcceptLanguage(header)` (pure, unit-testable).
- `src/i18n/request.ts` — `getRequestConfig`: cookie → Accept-Language → default; dynamic catalog import (explicit locale→import map fallback if standalone tracing misses it).
- `src/i18n/actions.ts` — `"use server"` `setLocaleCookie(locale: Locale)`; validates against `locales`, sets one-year `path=/; SameSite=Lax` cookie.
- `src/components/layout/LocaleControl.tsx` — `"use client"` select (mirrors `ThemeControl`); calls the server action; native labels.
- `src/global.d.ts` — `declare module "next-intl" { interface AppConfig { Locale; Messages } }` importing `messages/en.json` (v4 target — **not** `IntlMessages`).
- `src/test-utils/render-with-intl.tsx` — Vitest/RTL wrapper; `locale` + optional `now` + `timeZone="UTC"`.
- `.trellis/spec/frontend/i18n.md` — conventions doc (catalog/namespace rules, server vs client usage, switcher pattern, testing wrapper, error-key conventions).

Modified:

- `next.config.ts` — `createNextIntlPlugin()` no-arg wrapper (never an absolute path).
- `src/app/layout.tsx` — `generateMetadata` + `getTranslations("RootLayout")`; `getLocale()` → `<html lang>`; `<NextIntlClientProvider>` outside `AppProviders`, no props.
- `src/app/(app)/settings/general/page.tsx` — catalog copy + `LocaleControl` next to `ThemeControl`.
- Copy migration in this child: `components/layout/` user-facing strings (AppSidebar, SettingsNav, SidebarUserMenu, InsetHeader, PageHeader), `components/common/EmptyState.tsx`, `components/ui/{sidebar,dialog,sheet}.tsx` (generated files — minimal string-only edits, recorded in the commit message).
- Tests touched above render through `render-with-intl`.

## Part B — server error localization

### Contract

- `AppError(code, status, messageKey, params?, details?)`; `AppErrorMessageKey` derived from the `Errors` catalog so throw sites are compile-checked. Server never sends display English.
- Envelope: `{ error: { code, messageKey, params?, details? } }` (`message` removed).
- Zod: `VALIDATION_FAILED` + `messageKey: "validation.failed"`; `details.fieldErrors[field] = { key, params? }` mapped from Zod issue codes; unknown → `validation.invalid`.
- Client helper keeps the name: `apiErrorMessage(error, t, fallbackKey)` with `t = useTranslations("errors")`; resolves `t.has(messageKey)` → `t(key, params)`, else `t("generic")`, else localized action fallback. Dynamic-key typing: `t.has` guard + narrow cast (parent design §7).
- Provider/upstream text and log output stay verbatim/English; only our wrapper copy becomes keys.

### Files

- `src/server/errors.ts` — message field → `messageKey` + `params`.
- `src/app/api/_lib/with-error-handling.ts` — envelope + Zod mapping.
- ~24 server files with `new AppError(` (services, `src/server/ai/*`, `src/server/auth/actor.ts`, API routes) — strings → keys, values → params.
- `src/lib/api/error-message.ts` — new signature with translator.
- ~30 `apiErrorMessage` call sites across `components/{assistant,auth,chat,provider,search,topic}` — updated here so `i18n-ui` inherits the finished pattern.
- `messages/*.json` — `Errors` (incl. action fallbacks used above) and `Validation` namespaces.
- Tests: `src/server/errors.test.ts`, service/integration tests asserting messages, component tests asserting error toasts (only those touched by the call-site update).
- Streaming audit: `src/app/api/chat/route.ts`, `src/app/api/chat/stop/route.ts`, `src/server/ai/provider-error.ts`, plus the client display path in `ChatView`/message error rendering — identify which strings are ours (→ keys) vs upstream (→ verbatim). Record the audit result in the commit or task notes.

### Risks

- Envelope is an app-internal breaking change; land it atomically in one commit batch (server + helper + call sites + tests together) so no intermediate commit has a broken contract.
- `apiErrorMessage` call sites span files that `i18n-ui` will later restructure; keep the changes mechanical (signature + error strings) to minimize merge friction.
- Error-key audit must not miss dynamically constructed messages (e.g. provider status fallbacks) — grep for `new AppError` and string interpolation before finishing.

## Shared risks / verification notes

- Turbopack: plugin must be no-arg; verify `pnpm dev` and `pnpm build`.
- Standalone Docker smoke test: `DOCKER_BUILD=1 pnpm build`, run the standalone server, load a server-translated + client-translated page; if the config alias fails (next-intl #2339 class), pass `locale/messages/now/timeZone/formats` explicitly to the provider and document it in the spec.
- Locale resolution unit tests: cookie hit, cookie miss + `zh-CN` header, `zh-Hans` prefix match, q-ordering, absent/invalid header → `en`.
- Error tests: representative failures in both locales + unknown-key fallback + validation field errors.

## Rollback

Two logical commit batches inside one task: (A) infrastructure, (B) error contract. Either can be reverted independently; A is self-contained in layout/config, B is atomic across server/client/tests. No data migration, no URL change, cookie additive.
