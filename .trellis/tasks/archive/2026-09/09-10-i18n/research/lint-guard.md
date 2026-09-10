# Research: ESLint 9 regression guard for hardcoded user-facing strings (Q6)

- **Query**: Best currently-maintained ESLint 9 flat-config option to flag hardcoded user-facing strings in TSX, compatible with `eslint-config-next@16.3.3`; concrete flat-config snippet for `eslint.config.mjs`.
- **Scope**: external (npm/GitHub/rule source) + empirical smoke test on this toolchain
- **Date**: 2026-09-10
- **Verdict**: `eslint-plugin-i18next@6.1.5` via its `flat/recommended`-style config, calibrated with `mode: "jsx-only"` + attribute excludes. A `no-restricted-syntax` variant exists as a zero-dependency fallback with documented gaps.

## Option comparison

| Option | Version / last publish | ESLint 9 flat config | Maintained | Notes |
|---|---|---|---|---|
| **`eslint-plugin-i18next`** | **6.1.5** / 2026-06-28 | Yes — ships `configs['flat/recommended']` ("for ESLint v9") | **Yes, actively** | Single rule `i18next/no-literal-string`; options designed for exactly this task; no peer dependency (works with any ESLint) |
| `eslint-plugin-react-i18next` | 1.1.0 / **2022-05-01** | Uncertain, no recent releases | **No — unmaintained ~4 years** | Fork-era artifact; reject |
| `no-restricted-syntax` (built-in) | ESLint 9.39.5 | Yes, core rule | Yes | Zero deps; needs hand-rolled selectors; misses some cases (see below) |

## Verified flat-config snippet for this repo

`eslint.config.mjs` currently uses `defineConfig([...nextVitals, ...nextTs, {...}])`. Integrate like this:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import i18next from "eslint-plugin-i18next";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  // ...existing overrides...
  i18next.configs["flat/recommended"],
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": {
            exclude: [
              "className",
              "data-testid",
              "src",
              "href",
              "type",
              "id",
              "key",
              "style",
              "aria-hidden",
              "role",
            ],
          },
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/server/db/migrations/**",
  ]),
]);

export default eslintConfig;
```

Notes:

- The spread `i18next.configs["flat/recommended"]` carries `i18next/no-literal-string: 2` with default options; the block after it re-declares the rule to calibrate options (later configs win in flat config). An inline `plugins: { i18next }` + rule block also works.
- `pnpm lint` runs `eslint src`, so the guard only sees `src/` — no need to ignore config files or `messages/`.
- Plugin has **no peerDependencies** and `engines: node >=18.10.0`; `eslint-config-next@16.3.3` coexistence is unaffected (both are plain flat-config entries).

## What the rule flags (verified in an isolated smoke test)

Test project: `eslint@9.39.5` + `typescript-eslint@8.68.0` (same versions as the repo's toolchain) + `eslint-plugin-i18next@6.1.5`, flat config, `mode: "jsx-only"` with attribute excludes. Fixture + observed output:

```
  7:11  error  disallow literal string: <h1>Hello world</h1>       i18next/no-literal-string   ← JSX text ✓
  9:11  error  disallow literal string: {'Inline literal'}         i18next/no-literal-string   ← literal in JSX expression ✓
 10:58  error  disallow literal string: aria-label="Submit form"   i18next/no-literal-string   ← attribute (jsx-only) ✓
 10:72  error  disallow literal string: <button …>Go</button>      i18next/no-literal-string   ← button text ✓
 13:32  error  disallow literal string: alt="A cat"                i18next/no-literal-string   ← attribute ✓
```

Not flagged in the same run: `className="btn"`, `data-testid="x"`, `src="/hero.png"` (excluded attributes), `t('greeting')` (`t` is in the default `callees.exclude`), and `console.log('debug')` (outside JSX; mode is JSX-scoped).

Behavior/options (from README + `lib/options/defaults.js` of 6.1.5):

- `mode`: `jsx-text-only` (default — JSX text only), `jsx-only` (+ attributes), `all` (everything — too noisy).
- Calibration buckets: `words`, `jsx-components`, `jsx-attributes`, `callees`, `object-properties`, `class-properties`, each with `include`/`exclude` regex arrays.
- Default excludes worth knowing: attributes (`className`, `styleName`, `style`, `type`, `key`, `id`, `width`, `height`), callees (`t`, `i18n(ext)?`, `require`, `addEventListener`, `includes`, `indexOf`, `endsWith`, `startsWith`, …), words (punctuation-only, **ALL-CAPS strings**, HTML entities, emoji). Consequence: `<div>OK</div>` passes and must be caught by review/sweep, not lint.
- Rule emits errors only — no auto-fix (by design, since keys ≠ literals).

## `no-restricted-syntax` fallback (verified selectors)

Zero-dependency alternative, tested on the same toolchain:

```js
const NON_USER_ATTRIBUTES = ["className", "data-testid", "src", "href", "type", "id", "key", "style"];

{
  files: ["src/**/*.tsx"],
  rules: {
    "no-restricted-syntax": ["error",
      { selector: "JSXText[value=/[A-Za-z]/]", message: "Hardcoded user-facing text; use next-intl." },
      {
        selector: `JSXAttribute${NON_USER_ATTRIBUTES.map((n) => `:not([name.name="${n}"])`).join("")} > Literal[value=/[A-Za-z]/]`,
        message: "Hardcoded user-facing attribute; use next-intl.",
      },
    ],
  },
}
```

Empirically verified:

- `[name="className"]` does **not** work for JSX exclusions (the attribute's `name` is a node); `[name.name="className"]` does.
- Misses string literals inside JSX expression containers, e.g. `{'Inline literal'}` or `{ok ? 'Enabled' : 'Disabled'}`. Adding `JSXExpressionContainer Literal[value=/[A-Za-z]/]` (descendant) catches them but produces false positives — it also flags `t('greeting')` and `console.log('debug')`.

Given the two gaps, the plugin is the better guard; the fallback is viable only for JSX text + attributes.

## Fit with the task plan

- `implement.md` schedules `i18n-guard` last, after all migration children — the guard config will immediately flag any remaining hardcoded strings, which is exactly why it lands last. The rule level (`error` vs `warn`) and the attribute-exclude list are the calibration knobs during rollout.
- `eslint-config-next@16.3.3` does not ship any i18n string rules; adding this plugin does not conflict with it (verified flat-config composition in the smoke test).
- The guard is lint-only; it does not translate anything, and it intentionally cannot prove a string is translation-key-shaped — it only catches hardcoded literals in JSX.

## Sources

- npm: `eslint-plugin-i18next@6.1.5` (version, publish date, no peerDeps, engines), `eslint-plugin-react-i18next@1.1.0` (last publish 2022-05-01)
- https://github.com/edvardchen/eslint-plugin-i18next — README (`flat/recommended`, ESLint 9 section), `docs/rules/no-literal-string.md` (options), `lib/options/defaults.js` (default excludes), `lib/index.js` (flat config export)
- Empirical smoke test: isolated `/tmp` project with `eslint@9.39.5`, `typescript-eslint@8.68.0`, `eslint-plugin-i18next@6.1.5` (outputs quoted above)
- Repo files: `eslint.config.mjs`, `package.json` (`lint` script, eslint/eslint-config-next versions)
