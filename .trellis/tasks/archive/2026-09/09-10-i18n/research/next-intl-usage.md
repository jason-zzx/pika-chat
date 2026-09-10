# Research: next-intl usage patterns, TypeScript, and testing (for pika-chat)

- **Query**: How to use next-intl 4.14.2 for Server + Client Components, ICU messages, localized timestamps (`MessageTimestamp`), `generateMetadata`, type-safe keys, and Vitest tests — shaped for this repo.
- **Scope**: mixed (official docs + shipped package types/source + repo files)
- **Date**: 2026-09-10
- **Depends on**: `next-intl-setup.md` (versions + install). Facts below verified against the published 4.14.2 tarballs and next-intl.dev docs.

## 1. Server Components vs Client Components (Q3)

- `useTranslations`, `useFormatter`, `useLocale`, `useNow`, `useTimeZone` are imported **from `next-intl`** and work in both Server Components (non-async) and Client Components — next-intl uses `react-server` conditional exports to pick the implementation. Verified docs statement: "If you import useTranslations, useFormatter, useLocale, useNow and useTimeZone from a shared component, next-intl will automatically provide an implementation that works best for the environment this component executes in (server or client)."
- **Hooks cannot be called from async components.** Async Server Components use the awaitable APIs from **`next-intl/server`** (verified export list of 4.14.2): `getTranslations`, `getFormatter`, `getNow`, `getTimeZone`, `getMessages`, `getLocale`, `getRequestConfig`, `setRequestLocale` (deprecated), `getExtracted` (experimental extraction).
- Official guidance: prefer non-async function components for shared components — they can run in either environment and are simpler to test.

```tsx
// Server Component (async) — e.g. a settings page
import { getTranslations } from "next-intl/server";
const t = await getTranslations("Settings.General");
return <h1>{t("title")}</h1>;

// Server or Client Component (non-async) — e.g. src/components/chat/Composer.tsx
import { useTranslations } from "next-intl";
const t = useTranslations("Chat.Composer");
return <button>{t("send")}</button>;
```

Translator API (verified in `use-intl@4.14.2` `createTranslator.d.ts`): callable `t(key, args)`, plus `t.rich`, `t.markup`, `t.raw`, `t.has(key): boolean`.

Namespacing rules (docs, verified): namespace keys **cannot contain `.`** (it expresses nesting); nested JSON is supported and namespaced with dots at call sites; ICU value names are alphanumeric + underscore only (no dashes — e.g. map `zh-CN` → `zh_CN` if used as a select value).

## 2. ICU message examples (Q3)

```jsonc
{
  "Chat": {
    "Composer": {
      "placeholder": "Message {assistantName}…",              // interpolation
      "charCount": "{count, plural, =0 {No characters} one {# character} other {# characters}}",
      "send": "Send",
      "sendHint": "Press <kbd>Enter</kbd> to send",           // t.rich tag
      "relativeMinutes": "{count, plural, =1 {1 minute ago} other {{count} minutes ago}}"
    }
  }
}
```

- Cardinal plural: `{count, plural, =0 {no followers yet} =1 {one follower} other {# followers}}` — `#` is the number, formatted per locale.
- Ordinal: `{year, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}`.
- `select`: `{gender, select, female {She is} male {He is} other {They are}} online.` — `other` is required.
- Escaping: wrap literal braces in single quotes (`'{name}'`).
- Rich text: `t.rich("sendHint", { kbd: (chunks) => <kbd>{chunks}</kbd> })`; tags cannot carry attributes in messages (attributes live at the call site).

## 3. Dates/times: `MessageTimestamp` + `src/lib/message-time.ts` (Q3, R6)

### Available APIs (verified signatures)

- `useFormatter()` → `format.dateTime(date, options?)`, `format.relativeTime(date, nowOrOptions?)`, `format.dateTimeRange`, etc. (client & non-async server).
- `useNow({updateInterval})` — replaces `MessageTimestamp`'s manual `setInterval`; "the returned value is consistent across re-renders on the client; updateInterval updates it continuously".
- Server contexts without components: `getFormatter()` from `next-intl/server`.

### `relativeTime` semantics (read from shipped `use-intl@4.14.2` source)

- Unit auto-selected by absolute difference: `<1min → seconds`, `<1h → minutes`, `<1d → hours`, `<1w → days`, `<1mo → weeks`, `<1y → months`, else `years`; value is `Math.round(seconds / unitSeconds)`.
- `numeric: 'auto'` is used **only for the seconds unit** (so <~0.5s rounds to "now"); all other units use `numeric: 'always'` → output like "2 hours ago" (never "yesterday").
- Options: `{now, unit, style: 'long' | 'short' | 'narrow', numberingSystem}`.
- If `now` is not passed and no global `now` is configured, next-intl emits a dev warning: "The `now` parameter wasn't provided to `relativeTime`…" and falls back to `new Date()`.

### Delta vs. current `formatMessageAge` (`src/lib/message-time.ts:38-60`)

Current behavior: `"just now"` < 1 min; `"N minutes ago"` < 1 h; `"N hours ago"` < 1 day; else short date (`Sep 3`, plus year when different year). `format.relativeTime` differs at the edges: it says "30 seconds ago" (seconds unit) instead of "just now", and switches to "3 days ago" / "2 weeks ago" instead of a date after 1 day. Two faithful options:

1. **Use `relativeTime` + `dateTime`**: `format.relativeTime(date, {now})` for minutes/hours; `format.dateTime(date, {month: "short", day: "numeric"})` (+ `year: "numeric"` when different year) for older messages. Accepts Intl-style seconds/days/weeks wording.
2. **Preserve current thresholds exactly**: keep the branching, but source strings from ICU plurals (`relativeMinutes`, `relativeHours`) and format the fallback date with `format.dateTime`. The `"just now"` boundary stays custom.

`formatMessageExact` (tooltip `yyyy-MM-dd HH:mm:ss`) maps to `format.dateTime(date, {year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"})`; exact zero-padded output is locale-dependent, so keep the helper only if the exact string matters.

Pure module caveat: `src/lib/message-time.ts` cannot call hooks. Docs are explicit that translations live in components (exception: Server Actions / Metadata / Route Handlers via `next-intl/server`). So either pass `t`/`format` output into the helper, or move formatting into `MessageTimestamp.tsx` (which is already a client component; its `setInterval` + `useState` become `useNow({updateInterval: 30_000})`).

**timeZone caveat**: without a global `timeZone` in `getRequestConfig` (or a provider/`relativeTime`-level `now`/`timeZone`), next-intl warns "The `timeZone` parameter wasn't provided…" and timestamps can differ between server render and hydration (server runtime zone vs browser zone). Decide a global `timeZone` (e.g. from the same locale config) or render these client-side deliberately.

## 4. `generateMetadata` / static metadata (Q3)

- Request-scoped titles/descriptions must use `generateMetadata` + `getTranslations` (official example does this in the root layout of the without-routing example).
- `export const metadata` is evaluated outside the request and **cannot** read the locale cookie — it must be replaced when localizing `src/app/layout.tsx:22-25`.

```tsx
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("RootLayout");
  return { title: t("title"), description: t("description") };
}
```

- Server Actions can pass an explicit locale: `getTranslations({namespace: "Errors", locale})` resolves against the request config; relevant for R5 if any server-side text is ever returned instead of codes (docs caution that messages generated in actions can outlive a locale switch unless re-rendered).

### Dynamic keys (R5: error `code` → localized message on the client)

`t` is callable with dynamic keys at runtime; `t.has(key)` is a runtime check (verified in `Translator` type). With message-key augmentation ON, a fully dynamic `string` key needs a narrow/cast; `t.has` first keeps fallbacks safe. ICU params (e.g. `{providerName}`) cover interpolated server errors.

## 5. TypeScript: type-safe keys + arguments (Q4)

### Message keys (recommended)

v4 uses the `AppConfig` interface — **not** the v3-era `IntlMessages` (verified: `use-intl@4.14.2` ships `AppConfig` as the augmentation target; `IntlMessages` only survives as an internal type alias). Old snippet `declare module 'next-intl' { interface IntlMessages extends Messages {} }` will silently not work.

```ts
// src/global.d.ts — included by tsconfig ("**/*.ts"), docs call it global.ts/global.d.ts
import { locales } from "@/i18n/locales";
import messages from "../messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number]; // 'en' | 'zh-CN'
    Messages: typeof messages;        // type-safe keys & namespaces
    // Formats: typeof formats;       // optional, only if global formats are used
  }
}
```

Docs troubleshooting notes: the interface must be named `AppConfig`, and the declaration file must be included in `tsconfig.json`.

### Type-safe message **arguments** (optional, extra setup)

TypeScript infers imported JSON as loose types; to validate ICU argument names:

1. `tsconfig.json`: add `"allowArbitraryExtensions": true`.
2. `next.config.ts`: `createNextIntlPlugin({ experimental: { createMessagesDeclaration: "./messages/en.json" } })`.
3. Run `next dev` / `next build` / `next typegen` once → generates `messages/en.d.json.ts` (add `messages/*.d.json.ts` to `.gitignore`).

Open issue #2296: `RangeError` with 2,500+ keys in one file — not a concern at pika-chat's scale, but relevant if catalogs grow enormous. Note: the design plan mentions per-namespace catalog files; `createMessagesDeclaration` accepts a path **array**, and/or build the `Messages` type from a merged import in the declaration file — both documented/supported.

## 6. Vitest + Testing Library (Q5, R8)

Docs-provided pattern (works with `@testing-library/react` + vitest):

```tsx
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en.json"; // path per repo layout
import Component from "./Component";

function renderWithIntl(ui: React.ReactNode, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

it("renders translated copy", () => {
  renderWithIntl(<Component />);
  expect(screen.getByText("Send")).toBeInTheDocument();
});
```

- **Provider required**: without it, hooks throw "Failed to call useTranslations because the context from NextIntlClientProvider was not found." (docs troubleshooting).
- **Locale-specific tests**: pass `zh-CN` messages/locale to assert Chinese output. (Provider rendered from a Client Component/test requires the explicit `locale` prop; inheritance only applies when rendered by a Server Component.)
- **Determinism**: pass `now={new Date(fixed)}` and `timeZone="UTC"` to the provider for stable `relativeTime`/`dateTime` output.
- **Async Server Components** can't be rendered directly by Testing Library — the docs recommend keeping shared components non-async so they stay testable.
- **Vitest config**: next-intl is ESM-only and docs recommend `test.server.deps.inline: ["next-intl"]` (needed when using `createNavigation`; pika-chat has no i18n navigation, so it is likely unnecessary — harmless to add per docs example). Verified `server.deps.inline` still exists in the installed Vitest **4.1.11** types (`ServerDepsOptions.inline`).
- Repo context: `vitest.config.mts` has three projects (`unit-node`, `unit-dom`, `integration`); provider wrapping applies to the `unit-dom` (jsdom) project's `.tsx` tests, and any `unit-node` tests that import UI must stay provider-free or use a non-component code path.

## Sources

- https://next-intl.dev/docs/environments/server-client-components (hook availability, non-async guidance)
- https://next-intl.dev/docs/usage/translations (ICU syntax, plurals, select, rich text, key rules)
- https://next-intl.dev/docs/usage/dates-times (dateTime/relativeTime/useNow/updateInterval)
- https://next-intl.dev/docs/workflows/typescript (AppConfig, createMessagesDeclaration, allowArbitraryExtensions, troubleshooting)
- https://next-intl.dev/docs/environments/actions-metadata-route-handlers (generateMetadata, Server Actions, explicit locale)
- https://next-intl.dev/docs/environments/testing (provider wrapper, Vitest inline note)
- Shipped source of `next-intl@4.14.2` / `use-intl@4.14.2`: `dist/types/server/react-server/index.d.ts` (server API list), `dist/types/core/AppConfig.d.ts` (augmentation target), `dist/types/core/createTranslator.d.ts` (`t.has/.rich/.raw/.markup`), `dist/esm/development/initializeConfig-*.js` (`relativeTime` unit thresholds/rounding/numeric), `dist/types/core/RelativeTimeFormatOptions.d.ts`, `dist/types/core/DateTimeFormatOptions.d.ts`
- Repo files consulted: `src/app/layout.tsx`, `src/lib/theme.ts`, `src/lib/message-time.ts`, `src/components/chat/MessageTimestamp.tsx`, `src/components/providers/AppProviders.tsx`, `vitest.config.mts`, `tsconfig.json`
