# Research: next-intl setup for pika-chat (cookie locale, no URL prefix, Next 16.3.3)

- **Query**: Which next-intl version works with Next 16.3.3 + React 19.2.8 today, and what is the exact cookie-based "without i18n routing" setup (request config, provider, locale switching) shaped for this repo?
- **Scope**: mixed (npm/GitHub/docs + repo files)
- **Date**: 2026-09-10
- **Verdict**: use **`next-intl@4.14.2`** (pinned). It is the officially supported, documented path for exactly this scenario (no `[locale]` segment, cookie-based locale), and its official example is CI-tested against `next@^16.3.1` + `react@^19.2.3`.

## 1. Version compatibility (Q1)

| Fact | Value | Source |
|---|---|---|
| Latest next-intl | **4.14.2**, published 2026-09-01 | `npm view next-intl dist-tags` → `latest: 4.14.2`; CHANGELOG.md |
| peerDependencies | `next: ^12 \|\| ^13 \|\| ^14 \|\| ^15 \|\| ^16`, `react: ^16.8 \|\| ^17 \|\| ^18 \|\| >=19.0.0-rc <19.0.0 \|\| ^19` | `npm view next-intl@4.14.2 peerDependencies` |
| Next 16.3.3 / React 19.2.8 satisfied | Yes — `^16.0.0` covers 16.3.x; `^19.0.0` covers 19.2.8 | npm metadata |
| Next 16 support introduced | `4.4.0` (2025-10-22) — "Next.js 16 update (#2054)" | CHANGELOG.md |
| Next 16.3-specific fixes | `4.13.3` (locale cookie only updated for document requests, not prefetches, #2355); `4.13.4` (avoid `usePathname()` reads for non-locale-switching links under partial prefetching, #2362) | CHANGELOG.md |
| Recommendation | pin **4.14.2** (any version ≥ 4.13.4 has the 16.3 behavior fixes) | synthesis of above |
| API deprecations to know | `setRequestLocale` deprecated in 4.13.5 (#1632); `requestLocale` param of `getRequestConfig` deprecated in 4.13.6 (#2380). Neither is needed for the cookie-based setup. | CHANGELOG.md |
| Engines | no `engines` field on 4.14.2; docs: Node ≥ 13 for all Intl APIs. Repo uses Node ≥ 22 → fine. | `npm view`; docs runtime-requirements |

Turbopack notes (Next 16 uses Turbopack by default; this repo's `next build`/`next dev` will):

- The plugin auto-configures Turbopack on Next ≥ 16: `shouldConfigureTurbo = process.env.TURBOPACK != null || isNextJs16OrHigher()` and sets `nextConfig.turbopack.resolveAlias['next-intl/config']` (verified in shipped source `dist/esm/development/plugin/getNextConfig.js`).
- **Gotcha**: an **absolute** path passed to `createNextIntlPlugin(path)` throws under Turbopack: "Turbopack support for next-intl currently does not support absolute paths, please provide a relative one". Use the no-arg form (auto-discovery) or a relative `'./src/i18n/request.ts'`.
- 4.13.7 pinned `@swc/core` (~1.16.0) as a direct dependency for the optional extractor; irrelevant unless using `experimental.extract`/`useExtracted` (out of scope here).

Known issues assessed (none are blockers):

- **#2339** "NextIntlClientProvider SSR wrapper triggers Couldn't-find-config-file on every render in Next 16.2.4 + Turbopack production" (reported 2026-05-27, next-intl 4.12.0): maintainer closed as no-reproduction / usage question, converted to discussion #2340. Symptom: production-only 500 where the `next-intl/config` alias doesn't bind in SSR chunks; workaround is passing `locale`, `messages`, `now`, `timeZone`, `formats` **all explicitly** to `NextIntlClientProvider`. Caveat for our Docker/Turbopack build — smoke-test the standalone image (see §4).
- **#2381** "Next.js 16.3 cached components + partial prefetching infinite request waterfall" (2026-08-10): root-caused by the maintainer as a **Next.js bug**, reproduced without next-intl, fix already coming in vercel/next.js#97128. Not a next-intl issue; also requires opt-in `cacheComponents` + partial prefetching (not enabled in this repo).
- **#2296** (open) `RangeError: Map maximum size exceeded with createMessagesDeclaration on large message files (~2,500+ keys)`. Only if using the optional `createMessagesDeclaration` (Q4); pika-chat catalogs will be far below that size.

Alternatives evaluated (in case next-intl had blockers — it doesn't):

- `react-i18next@17.0.13` (published 2026-09-01; maintained) — works with RSC only via extra instance/provider plumbing; no first-class cookie/no-routing Next.js integration.
- `@lingui/core@6.6.0` (published 2026-07-24; maintained) — macro-based extraction, heavier build integration.
- **Decision: next-intl.** Rationale: dual Server/Client Component support via conditional exports, documented cookie-based setup without routing, official Next 16.3 example, active maintenance (releases through 2026-09-01), type augmentation built in.

## 2. Exact "without i18n routing" setup (Q2)

### Install

```bash
pnpm add next-intl@4.14.2
```

### File layout (repo-shaped)

```
messages/
  en.json
  zh-CN.json
src/
  i18n/
    locales.ts       # shared locale constants (no next/headers imports)
    request.ts       # getRequestConfig — auto-discovered at ./src/i18n/request.ts
  global.d.ts        # AppConfig augmentation (see usage doc)
next.config.ts       # wrapped with createNextIntlPlugin()
src/app/layout.tsx   # NextIntlClientProvider + <html lang={locale}> + generateMetadata
```

`i18n/request.ts` is auto-discovered at `./i18n/request.ts` **or** `./src/i18n/request.ts` (extensions `.ts/.tsx/.js/.jsx`). No plugin argument needed.

### `src/i18n/locales.ts` — shared constants (avoids importing server module into type files)

```ts
export const locales = ["en", "zh-CN"] as const;
export type Locale = (typeof locales)[number];
export const DEFAULT_LOCALE: Locale = "en";
```

### `src/i18n/request.ts` — cookie → Accept-Language → en

Official docs show the cookie shape; the Accept-Language fallback is app logic (docs only show `store.get('locale')?.value || 'en'`). `cookies()` and `headers()` are both async in Next 16.

```ts
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, locales, type Locale } from "./locales";

export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

function isLocale(value: string | undefined): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}

// Minimal Accept-Language negotiation: highest-q supported tag wins;
// `zh` / `zh-Hans` etc. match the `zh-CN` catalog by prefix.
function matchAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined;
  const entries = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of entries) {
    const exact = locales.find((l) => l.toLowerCase() === tag);
    if (exact) return exact;
    const prefix = tag.split("-")[0];
    const byPrefix = locales.find((l) => l.toLowerCase().split("-")[0] === prefix);
    if (byPrefix) return byPrefix;
  }
  return undefined;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE_NAME)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : matchAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
    // timeZone: see "dates" doc for when to set a global time zone
  };
});
```

Notes:

- The template-literal dynamic import is the **official example's** exact pattern (`examples/example-app-router-without-i18n-routing/src/i18n/request.ts`), running on Next 16.3 in the next-intl repo. If Docker standalone tracing ever fails to include a catalog, fall back to an explicit map: `{ en: (await import('../../messages/en.json')).default, 'zh-CN': (...) }[locale]` (both imports statically analyzable).
- Reading cookies/headers here makes every translated route dynamic. pika-chat's root layout **already** calls `await cookies()` (`src/app/layout.tsx:30-32`), so this is not a new static→dynamic regression.
- `Accept-Language` parsing has no built-in helper exported by next-intl. (`negotiator` and `@formatjs/intl-localematcher` are transitive dependencies of next-intl, not public API — don't import them directly; the ~20-line matcher above or an own dependency is the clean route.)

### `next.config.ts` — wrap plugin, keep existing fields

```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  agentRules: false,
  allowedDevOrigins: ["192.168.99.203"],
};

// No-arg form auto-discovers ./src/i18n/request.ts.
// Never pass an absolute path here — Turbopack rejects it.
const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
```

### `src/app/layout.tsx` — provider + `lang` + metadata

Official example (verified in repo) uses `getLocale()` for `<html lang>` and `generateMetadata` + `getTranslations`. `NextIntlClientProvider` rendered **from a Server Component inherits `locale`, `messages`, `now`, `timeZone`, `formats`** from `i18n/request.ts` — no props required. Opt-out is `messages={null}`; selective provision is `messages={pick(messages, 'Namespace')}`.

```tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Geist, Geist_Mono } from "next/font/google";

import ThemeSync from "@/components/layout/ThemeSync";
import AppProviders from "@/components/providers/AppProviders";
import { parseThemeCookie, THEME_COOKIE_NAME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("RootLayout");
  return { title: t("title"), description: t("description") };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const theme = parseThemeCookie((await cookies()).get(THEME_COOKIE_NAME)?.value);
  const locale = await getLocale();

  return (
    <html lang={locale} className={cn(/* ...unchanged... */)}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <AppProviders>
            <ThemeSync initialMode={theme.mode} />
            {children}
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

Provider placement: outside `AppProviders` (a client component) so every client component below can call `useTranslations`. Static `export const metadata` cannot read the request-scoped locale — `generateMetadata` is required.

### Locale switching without routing (R2)

The official example uses a **Server Action that sets the cookie**, invoked from a client component; Next.js re-renders the route after the action, so the UI updates without a manual reload. Issue #2162 ("Locale change via js-cookie doesn't trigger re-render without page refresh") was closed with the maintainer pointing at exactly this official example. Pattern:

```tsx
// server file (e.g. alongside Settings → General), or any Server Component
async function changeLocaleAction(locale: Locale) {
  "use server";
  (await cookies()).set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // mirror THEME_COOKIE_MAX_AGE in src/lib/theme.ts
    sameSite: "lax",
  });
}
```

```tsx
// client component (LocaleSwitcher) — mirrors ThemeControl's settings page placement
"use client";
import { useLocale, useTranslations } from "next-intl";

export default function LocaleSwitcher({
  changeLocaleAction,
}: {
  changeLocaleAction: (locale: Locale) => Promise<void>;
}) {
  const locale = useLocale();
  const t = useTranslations("Settings.General");
  return (
    <select value={locale} onChange={(e) => changeLocaleAction(e.target.value as Locale)}>
      <option value="en">{t("localeEnglish")}</option>
      <option value="zh-CN">{t("localeChinese")}</option>
    </select>
  );
}
```

A client-only `document.cookie` write (like `themeDocumentCookie` in `src/lib/theme.ts`) also works for persistence, but does **not** re-render the server tree by itself — that is the exact complaint in #2162. Prefer the server action.

## 3. Next 16 gotchas relevant to this repo (Q7)

- **Turbopack + plugin**: works out of the box on Next ≥ 16 (alias auto-configured). Just don't pass an absolute `requestConfig` path.
- **Static rendering**: with a cookie-read in `getRequestConfig`, pages using translations are dynamically rendered. No `setRequestLocale` equivalent is needed or wanted — it's deprecated (4.13.5), replaced by `next/root-params` for routed apps only.
- **`cacheComponents` (experimental, NOT enabled here)**: historical issues #2068/#2070 ("Uncached data was accessed outside of `<Suspense>`") apply only when opting into Next 16 Cache Components; wrapping dynamic reads in `<Suspense>` is the documented Next 16 remedy. Nothing to do now; flag if the repo ever enables `cacheComponents`.
- **`output: "standalone"` (Docker)**: no next-intl-specific configuration. Catalogs are bundled (JSON imported inside `request.ts`). The only historical standalone complaint (#1773, 2025) was closed as stale/no-reproduction. Residual risk is the #2339 class of production-Turbopack alias issues → **smoke-test the standalone Docker build** with a `getTranslations` render and a client `useTranslations` render in both locales; if the provider can't resolve config, pass all inherited props explicitly (documented workaround).
- **Client bundle size**: provider inheritance serializes all messages into the page stream. Docs recommend selective provision (`messages={pick(...)}`) only if Core Web Vitals regress; "measure before optimizing".

## Sources

- https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing
- https://next-intl.dev/docs/usage/configuration (provider inheritance, locale, messages, timeZone)
- https://raw.githubusercontent.com/amannn/next-intl/main/packages/next-intl/CHANGELOG.md (versions 4.4.0, 4.13.3–4.14.2)
- https://github.com/amannn/next-intl/tree/main/examples/example-app-router-without-i18n-routing (`request.ts`, `layout.tsx`, `LocaleSwitcher.tsx`, `next.config.ts`, package.json pins `next@^16.3.1`, `react@^19.2.3`)
- https://github.com/amannn/next-intl/issues/2339 (closed → discussion 2340), /2381 (Next.js bug → vercel/next.js#97128), /2162 (locale switch), /1773 (standalone, stale), /2296 (open declaration issue)
- npm: `next-intl@4.14.2` metadata (dist-tags, peerDependencies); `react-i18next@17.0.13`; `@lingui/core@6.6.0`
- Shipped package source inspected: `dist/types/plugin/types.d.ts`, `dist/esm/development/plugin/getNextConfig.js`, `dist/types/server/react-server/index.d.ts` (next-intl 4.14.2 tarball)
