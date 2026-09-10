# Design — i18n architecture (parent)

> Architecture, contracts, and cross-child decisions for the whole i18n effort. Child task designs must conform; if a child finds a decision wrong, fix this file first (Phase 1), then re-plan the child.
> Sources: `.trellis/tasks/09-10-i18n/research/next-intl-setup.md`, `next-intl-usage.md`, `lint-guard.md` (verified 2026-09-10).

## 1. Library

- **next-intl pinned to `4.14.2`** (peer deps `next ^16`, `react ^19`; Next 16.3 fixes in ≥4.13.4). Rejected alternatives: react-i18next (no first-class cookie/RSC integration), Lingui (macro/build complexity).
- Mode: **cookie-based, no i18n routing** — no `[locale]` segment, no middleware. Official next-intl example for exactly this mode runs on Next 16.3 CI.
- Plugin: `createNextIntlPlugin()` **no-arg** in `next.config.ts` (auto-discovers `./src/i18n/request.ts`). **Never pass an absolute path** — Turbopack throws.

## 2. Locale resolution & persistence

- Locale set + default in `src/i18n/locales.ts`: `locales = ["en", "zh-CN"]`, `DEFAULT_LOCALE = "en"`, `LOCALE_COOKIE_NAME = "NEXT_LOCALE"`, plus display labels (`English`, `简体中文` — native self-labels, intentionally not translated).
- Resolution order (in `src/i18n/request.ts`, `getRequestConfig`): `NEXT_LOCALE` cookie → `Accept-Language` (q-weighted, prefix match so `zh`/`zh-Hans` → `zh-CN`) → `en`.
- Cookie persistence mirrors the theme pattern: one year max-age, `path=/`, `SameSite=Lax` (cf. `THEME_COOKIE_MAX_AGE` in `src/lib/theme.ts`).
- Cookie writes happen only in a **Server Action** (`src/i18n/actions.ts`, `"use server"`). A `document.cookie` write does not re-render the server tree (next-intl #2162) — do not use it for the switcher.
- The root layout already calls `await cookies()` (`src/app/layout.tsx:30`), so request-dynamic rendering is not a new regression.

## 3. Catalog layout & namespaces

- **One catalog per locale, at repo root**: `messages/en.json` (source of truth) and `messages/zh-CN.json`. Not per-namespace files: UI children run sequentially, so merge conflicts are avoided by process, and the single file keeps the `AppConfig` type augmentation simple. If catalogs later exceed ~2,500 keys, revisit (next-intl #2296).
- Namespaces fixed here; children must not rename established ones:
  - `RootLayout`, `Layout` (sidebar/nav/header/common), `Common`
  - `Settings.*` (`General`, `Account`, `Providers`, `Search`, `Users`), `Admin`
  - `Auth`, `Account`
  - `Chat.*` (`Composer`, `MessageList`, `MessageItem`, `Actions`, `Pickers`, `Tools`, `Dialogs`, `Timestamp`), `Topic`
  - `Errors` (all API-error text incl. action fallbacks), `Validation` (Zod-derived field errors)
- Key rules: namespaces are dotted paths, keys cannot contain `.`; ICU for interpolation/plurals; locale codes used as ICU values must avoid dashes (`zh_CN`).
- `zh-CN` entries are authored by the same child that adds the `en` key — no translation backlog.

## 4. Root layout integration

Per research (official example shape), `src/app/layout.tsx` becomes:

- `generateMetadata` + `getTranslations("RootLayout")` replaces the static `metadata` export (static metadata cannot read the request-scoped locale).
- `const locale = await getLocale()` → `<html lang={locale}>`.
- `<NextIntlClientProvider>` rendered **outside** `AppProviders` (client component) with **no props** — server-rendered provider inherits `locale/messages/now/timeZone/formats` from `request.ts`.
- Known production/Turbopack risk (next-intl #2339 class): if the config alias fails in a standalone build, the documented workaround is passing `locale`, `messages`, `now`, `timeZone`, `formats` explicitly. Covered by the infra child's Docker smoke test.
- Provider inheritance streams all messages to the client. Optimization lever (`messages={pick(messages, ...)}`) is **deferred** until measured (docs say measure first).

## 5. Language switcher (R2)

- New client component `src/components/layout/LocaleControl.tsx` mirroring `ThemeControl` placement on `src/app/(app)/settings/general/page.tsx`.
- On change → Server Action `setLocaleCookie(locale)` from `src/i18n/actions.ts`; Next re-renders the route, UI updates without a manual reload.
- Control shows native language labels from `locales.ts`.

## 6. Timestamps & Intl (R6)

Behavior-preserving choice (PRD R6 only requires locale-correct rendering; current thresholds stay):

- `src/lib/message-time.ts` becomes locale-agnostic: `getMessageAge(iso, now)` returns a **descriptor** (`{ kind: "justNow" } | { kind: "minutes"; count } | { kind: "hours"; count } | { kind: "date"; date; withYear }`), plus `parseTimestamp` stays. `formatMessageExact` is replaced by formatter-based rendering.
- `MessageTimestamp.tsx` (already a client component): `useNow({ updateInterval: 30_000 })` replaces the manual `setInterval`; `useTranslations("Chat.Timestamp")` + ICU plurals for minutes/hours ("just now" stays a custom key); older messages render via `useFormatter().dateTime(...)` with `month/day` (+ `year` when different year).
- **No global `timeZone`** in `request.ts` (would change user-visible times): the formatter call passes `timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone` explicitly to avoid next-intl's dev warning and keep today's server/browser-local behavior.
- Pure `message-time.ts` unit tests keep covering bucketing; `MessageTimestamp.test.tsx` gains locale cases (en + zh-CN) with fixed `now`.

## 7. Server error localization (R5)

Contract change, atomic (commit batch B of `i18n-core`):

- `AppError` keeps `code` (coarse, for branching) / `status` / `details`, and replaces the display `message` with **`messageKey` + `params`**. `AppErrorMessageKey` is derived from the `Errors` catalog (`typeof messages.Errors`), so throw sites are compile-checked against real keys.
- Response envelope: `{ error: { code, messageKey, params?, details? } }`. The English `message` field is removed (app-internal API; note in rollback).
- Zod `ZodError` → `VALIDATION_FAILED` with `messageKey: "validation.failed"`; `details.fieldErrors` carries per-field `{ key, params? }` derived from Zod issue codes (`invalid_type`, `too_small`, …). Raw Zod English text is never returned; unknown issue codes → generic `validation.invalid`.
- Client: `apiErrorMessage(error, t, fallbackKey)` (same name, new signature) resolves `t.has(messageKey) ? t(messageKey, params) : t("generic")`; unknown/non-AppError → localized action fallback. All ~30 call sites updated in this child (they live across component directories; children migrating screens afterwards inherit the finished pattern).
- Server logs stay English with `requestId`; `provider-error.ts` summarized upstream detail stays **verbatim** (third-party text, not ours to translate) — only our wrapper text becomes keys. Streaming: our static wrapper copy localized; upstream detail untouched.
- Ordering consequence: error localization ships in `i18n-core`, before `i18n-ui`, so screens migrate once against the final error pattern (see `implement.md`).

## 8. Testing strategy (R8)

- Shared helper `src/test-utils/render-with-intl.tsx`: `NextIntlClientProvider locale={locale} messages={messages} now={fixed} timeZone="UTC"` wrapper (`locale` prop is required when the provider is rendered client-side/in tests).
- All migrated `.tsx` tests switch to this helper; locale-specific tests pass `zh-CN`.
- Locale resolution logic (`matchAcceptLanguage`) is exported and unit-tested as a pure function in `unit-node`.
- `server.deps.inline: ["next-intl"]` only if a Vitest ESM issue appears (not expected here; no `createNavigation` usage).

## 9. Regression guard (R7)

- `eslint-plugin-i18next@6.1.5`, flat config `configs["flat/recommended"]` + calibrated block: `mode: "jsx-only"` with attribute excludes (`className`, `data-testid`, `src`, `href`, `type`, `id`, `key`, `style`, `aria-hidden`, `role`). Verified against ESLint 9.39.5 + eslint-config-next 16.
- Known gaps to accept: ALL-CAPS strings (`OK`) pass by default; `t.has`-based dynamic keys need no special casing. `no-restricted-syntax` fallback documented in research but rejected (misses expression-container literals).
- Lands last (`i18n-guard`), after `i18n-core` + `i18n-ui`.

## 10. Docker / build

- `output: "standalone"` unchanged; catalogs are bundled via imports in `request.ts`. The infra child must smoke-test the standalone build in both locales (server `getTranslations` render + client `useTranslations` render); fallback per §4 if the alias fails.
- If dynamic-import tracing ever misses a catalog, replace the template-literal import with an explicit locale→import map (both statically analyzable).

## 11. Rollout & rollback

- Child order: `i18n-core` → `i18n-ui` → `i18n-guard` (sequential; see `implement.md` for gates).
- Each child = one commit batch; revert that commit to roll back. Root layout (`src/app/layout.tsx`) and the error envelope are the two high-blast-radius changes; both are self-contained per child.
- No data migration, no DB schema change, no URL change.

## 12. Deferred / non-goals

- URL-prefixed locales + SEO alternates; RTL; locales beyond `en`/`zh-CN`; DB-persisted per-user locale; selective message provisioning for bundle size; `createMessagesDeclaration` typed ICU args (optional, revisit if ICU args regress); localizing server logs or third-party provider text.
