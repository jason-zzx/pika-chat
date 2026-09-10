# Implement plan — i18n core

Read order for the implementer: `prd.md` → `design.md` (this dir) → parent `../09-10-i18n/design.md` → research files listed in `implement.jsonl`.

Two commit batches inside this task: **A) infrastructure**, **B) error contract**.

## Part A — locale infrastructure

1. `pnpm add next-intl@4.14.2` (exact pin; peer deps satisfied by Next 16.3.3 / React 19.2.8).
2. Create `src/i18n/locales.ts`: `locales`, `Locale`, `DEFAULT_LOCALE = "en"`, `LOCALE_COOKIE_NAME = "NEXT_LOCALE"`, `LOCALE_LABELS` (native labels), exported pure `matchAcceptLanguage` (q-weight, exact then prefix match). Add `src/i18n/locales.test.ts`.
3. Create `messages/en.json` + `messages/zh-CN.json` with namespaces `RootLayout`, `Layout`, `Common`, `Settings.General`; keys are added in the same commit as their component usage (steps 6–8) so neither exists without the other.
4. Create `src/i18n/request.ts` (`getRequestConfig`: cookie → `matchAcceptLanguage(await headers())` → default; template-literal catalog import per research §2) and `src/global.d.ts` (`AppConfig` augmentation — v4 interface name).
5. Wrap `next.config.ts` with `createNextIntlPlugin()` — **no argument** (Turbopack rejects absolute paths; auto-discovery finds `src/i18n/request.ts`). Keep existing config fields.
6. `src/app/layout.tsx`: replace static `metadata` with `generateMetadata` + `getTranslations("RootLayout")`; `<html lang={await getLocale()}>`; `<NextIntlClientProvider>` wrapping, outside `AppProviders`, no props.
7. Create `src/i18n/actions.ts` (`"use server"` `setLocaleCookie`, validates against `locales`) and `src/components/layout/LocaleControl.tsx`; wire into `src/app/(app)/settings/general/page.tsx` next to `ThemeControl`.
8. Migrate user-facing copy in: `components/layout/*` (AppSidebar, SettingsNav, SidebarUserMenu, InsetHeader, PageHeader, ThemeControl if any), `components/common/EmptyState.tsx`, `components/ui/{sidebar,dialog,sheet}.tsx` (minimal edits to generated files, recorded in the commit message).
9. Create `src/test-utils/render-with-intl.tsx` (provider wrapper with `locale`/`now`/`timeZone` props); update the tests touched in steps 6–8; keep `unit-node` non-UI tests provider-free.
10. Validation A: `pnpm lint`, `pnpm typecheck`, `pnpm test`; `pnpm dev` manual pass (switch locale → copy changes immediately, persists across reload, URL unchanged; `<html lang>` correct; fresh `Accept-Language: zh-CN` session shows Chinese). Commit batch A.

## Part B — server error localization

11. Audit before editing: `grep -rn "new AppError("` (≈73 sites / 24 files) and list every distinct user-facing message; design the `Errors` catalog keys (namespace `Errors`) with params for interpolations. Include Zod mapping keys (`Validation` namespace) and the `apiErrorMessage` action fallbacks.
12. `src/server/errors.ts`: replace `message: string` with `messageKey: AppErrorMessageKey` + `params?: Record<string, string | number>` (key union derived from the `Errors` catalog). Keep `code`/`status`/`details`.
13. `src/app/api/_lib/with-error-handling.ts`: new envelope; Zod → `VALIDATION_FAILED`, `messageKey: "validation.failed"`, `details.fieldErrors[field] = { key, params? }` from Zod issue codes (unknown → `validation.invalid`). Logged output unchanged (English, requestId).
14. Update all `new AppError(` sites: strings → keys, interpolations → params. Audit the streaming path (`chat/route.ts`, `chat/stop/route.ts`, `provider-error.ts`) — our wrapper copy → keys; upstream provider text stays verbatim.
15. Update `src/lib/api/error-message.ts` to `apiErrorMessage(error, t, fallbackKey)` (`t = useTranslations("errors")`, `t.has` + narrow cast); update all ~30 call sites mechanically.
16. Update tests: `src/server/errors.test.ts`, service/integration tests asserting messages, component tests for touched call sites. Add locale-specific assertions (`en` + `zh-CN`) for representative failures + unknown-key fallback + validation field errors.
17. Validation B: `pnpm lint`, `pnpm typecheck`, `pnpm test`; manual error-path checks (duplicate username, invalid provider key, 404 topic, validation failure) in both locales. Commit batch B.

## Part C — spec + final validation

18. Write `.trellis/spec/frontend/i18n.md`: catalog layout + namespaces, cookie/resolution rules, server vs client usage, switcher pattern (server action), testing wrapper, ICU conventions, error-key conventions (`messageKey` + params contract), common pitfalls (AppConfig not IntlMessages, no absolute plugin path, `t.has` for dynamic keys). `i18n-ui` must be able to migrate a screen from this doc alone.
19. Full validation: `pnpm lint`, `pnpm typecheck`, `pnpm test`; Docker smoke: `DOCKER_BUILD=1 pnpm build`, run the standalone server, load one server-translated + one client-translated page. If the config alias fails, apply the explicit-provider-props workaround from parent design §4 and document it in the spec.

## Risky files / rollback points

- `src/app/layout.tsx` — every route; self-contained in batch A.
- `next.config.ts` — build-wide; keep the diff to the plugin wrapper.
- `src/components/ui/*` — generated territory; string-only edits.
- Error envelope — atomic batch B (server + helper + call sites + tests); no intermediate commit with a broken contract.

## Pre-start checks

- `implement.jsonl` / `check.jsonl` curated (this dir) — done during planning.
- Parent design reviewed together with this plan (final planning summary).
