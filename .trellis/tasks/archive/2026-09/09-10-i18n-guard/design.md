# Design — i18n-guard (regression guard + integrated verification)

> Conforms to the parent design (`../09-10-i18n/design.md` §9) and the verified research in `../09-10-i18n/research/lint-guard.md`. This file fixes the guard configuration, allowlist policy, and the integrated-verification procedure.

## Regression guard

- Dependency: `eslint-plugin-i18next@6.1.5` (devDependency). Verified against ESLint 9.39.5 + eslint-config-next 16.3.3; no peer deps; ships a flat-config preset.
- `eslint.config.mjs`:
  - import the plugin, spread `i18next.configs["flat/recommended"]` (sets the rule to error), then a calibrated block for `src/**/*.{ts,tsx}` with:
    - `mode: "jsx-only"` (JSX text + attributes + string literals inside JSX expression containers — verified to catch all three, while leaving non-JSX code alone);
    - attribute excludes: `className`, `data-testid`, `src`, `href`, `type`, `id`, `key`, `style`, `aria-hidden`, `role` (plus the plugin's own defaults).
  - Test files: `i18next/no-literal-string: "off"` for `src/**/*.test.ts(x)` — tests intentionally contain literals/fixtures and are not user-facing.
  - Allowlist (file-scoped `off` with a one-line reason comment) only for non-translatable proper nouns, e.g. `src/components/provider/vendor-icons/marks.tsx` (vendor names in SVG titles). Every allowlist entry must carry the "why".
- Known accepted gap (documented in the spec): the plugin's default word excludes let ALL-CAPS tokens (`OK`) and punctuation/emoji pass; review + the final sweep cover those.
- The rule stays `error`; do not downgrade to `warn`. `pnpm lint` runs `eslint src`, so the guard only sees app code.

## Sweep

Run the guard across the repo, then triage every hit: real user-facing copy → migrate to catalogs (extend existing namespaces, en+zh together); legitimate non-copy literals → attribute exclude / allowlist with reason. Zero violations at the end.

## Locale extensibility (parent AC8)

Adding a locale must stay component-free. Exact steps to document (and dry-run once, then revert):
1. `src/i18n/locales.ts` — add the code to `locales` (+ native label);
2. add `messages/<code>.json` (copy of `en.json` to start);
3. `src/i18n/defaults.ts` — add the locale to `DEFAULT_MESSAGES` (typed `Record<Locale, …>`, so TypeScript lists every missing locale);
4. run `pnpm typecheck && pnpm test` — any further gaps surface here.
No component edits required; verify with a throwaway dry-run and record the observed failure/pass points.

## Integrated verification (parent AC1–AC8)

Headless evidence the guard agent must record in `verification.md` (task dir):
1. Full gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
2. Guard demonstration: add a temporary hardcoded JSX string to a component → `pnpm lint` fails with the expected rule → revert.
3. Standalone smoke: `DOCKER_BUILD=1 pnpm build`, run the standalone server, then HTTP checks:
   - `/sign-in` without cookie + `Accept-Language: zh-CN` → `lang="zh-CN"` and a Chinese marker (e.g. 登录/用户名);
   - same page with `NEXT_LOCALE=en` → `lang="en"` and English markers;
   - localized `metadata` title in both;
   - an error-path envelope check (`POST /api/chat {}` → 400 `{ code, messageKey, params? }`).
4. Note explicitly which checks remain manual (browser-only, cannot be proven headlessly): the Settings→General switcher click flow with no-reload re-render, visual pass over every screen, and live error toasts — provide a short manual checklist for the user.

## Risks

- Guard noise on legitimate literals: keep allowlists minimal and justified; never widen `words` globally just to silence one file.
- Do not touch application behavior while sweeping — copy migration only.
- Reverting the demonstration edit must leave the tree clean (`git diff` empty for that file).
