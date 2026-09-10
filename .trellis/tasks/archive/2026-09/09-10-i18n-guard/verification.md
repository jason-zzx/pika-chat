# Verification — i18n guard + integrated result

> Date: 2026-09-10. Working tree, no commits (per task plan). Commands run from the
> repo root. Baseline claim: 81 test files / 566 tests.

## 1. Artifacts

| File | Role |
|---|---|
| `eslint.config.mjs` | Guard: `flat/recommended` + calibrated block (`src/**/*.{ts,tsx}`, `mode: "jsx-only"`, attribute excludes, callees), rule off for `src/**/*.test.ts(x)`, vendor-icons allowlist |
| `package.json`, `pnpm-lock.yaml` | `eslint-plugin-i18next@6.1.5` devDependency |
| `messages/en.json`, `messages/zh-CN.json` | `Common.noEmojiFound`, `Common.selectEmoji` (en + zh together) |
| `src/components/ui/dialog.tsx` | `DialogFooter` close button: literal `Close` → `t("close")` (`Common`) |
| `src/components/ui/emoji-picker.tsx` | Empty state + footer hint → `Common` catalog keys |
| `src/components/admin/AdminUsersScreen.tsx` | Inline disable for `AssignableRole` ternary + select wire values (see §5) |
| `src/components/provider/ModelEditorDialog.tsx` | Inline disables for select wire values (see §5) |
| `.trellis/spec/frontend/i18n.md` | "Regression guard" + "Adding a locale" sections |

Also present in the sweep (no edits needed): generated `src/components/ui/*` primitives
covered by attribute excludes; `vendor-icons/marks.tsx` covered by the file allowlist.

## 2. Guard demonstration (AC: lint fails on new hardcoded copy)

Temporary edit in `src/components/topic/DeleteTopicDialog.tsx`: added
`<p>Hardcoded guard demo</p>` inside the dialog content.

```
$ pnpm lint
/home/zzx/Documents/repo/pika-chat/src/components/topic/DeleteTopicDialog.tsx
  73:12  error  disallow literal string: <p>Hardcoded guard demo</p>  i18next/no-literal-string

✖ 1 problem (1 error, 0 warnings)
[ELIFECYCLE] Command failed with exit code 1.
```

Reverted immediately; `git diff` for that file is empty and `pnpm lint` is clean again.

## 3. Full gate

| Command | Result |
|---|---|
| `pnpm lint` | exit 0, no output (final config, re-verified after all tree edits) |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | **81 files / 566 tests passed** (72.9s); no other vitest was running |
| `pnpm build` | success — route table emitted, `.next/BUILD_ID` written, empty stderr |
| `DOCKER_BUILD=1 pnpm build` | success — `.next/standalone/server.js` produced (17:33) |

## 4. Standalone smoke (parent ACs, headless)

Server: `PORT=3200 HOSTNAME=127.0.0.1 node .next/standalone/server.js` with `.env` loaded
(non-default port). All `/sign-in` requests returned HTTP 200.

| Request | Observed |
|---|---|
| no cookie, `Accept-Language: zh-CN` | `lang="zh-CN"`; markers 登录 ×10, 用户名 ×7, 密码 ×14, 立即注册 ×2; `<meta name="description" content="自托管的 AI 聊天">` |
| `Cookie: NEXT_LOCALE=en`, `Accept-Language: zh-CN` | `lang="en"`; markers Sign in ×6, Username ×6, Password ×12; `content="Self-hosted AI chat"` |
| `Cookie: NEXT_LOCALE=zh-CN`, `Accept-Language: en` | `lang="zh-CN"` (cookie wins in both directions) |
| no cookie, no `Accept-Language` | `lang="en"` (default) |

Metadata: `<title>Pika chat</title>` is the brand name in both locales; the localized
`description` is the observable metadata difference (as designed in `RootLayout`).

Error envelope: `POST /api/chat {}` → **HTTP 401**
`{"error":{"code":"UNAUTHENTICATED","messageKey":"auth.required"}}`.

> Deviation from the design note (expected 400 + `VALIDATION_FAILED`): `requireActor`
> runs before body parsing, so an anonymous request stops at auth. The wire contract
> `{ error: { code, messageKey } }` is confirmed on the built artifact; the 400
> validation path is covered by `with-error-handling` tests in the green suite.

Server stopped after the smoke (port 3200 closed, connection refused).

## 5. Calibration decisions + allowlist inventory

Rule configuration (all in `eslint.config.mjs`, each group commented there):

- **Mode** `jsx-only` + plugin `flat/recommended` (rule stays `error`).
- **Attribute excludes**: plugin defaults re-listed (`className`, `styleName`, `style`,
  `type`, `key`, `id`, `width`, `height`) plus markup/config classes: `htmlFor`, `name`,
  `autoComplete`, `inputMode`, `idPrefix`, `data-.*`, `aria-hidden`, `aria-current`,
  `role`, `src`, `href`, `overlayClassName`; design-system/positioning tokens: `variant`,
  `size`, `side`, `align`, `positionMethod`, `headerMode`, `collapsible`, `appearance`,
  `messageRole`; `defaultValue`; `fallbackErrorKey` (error-catalog key).
- **`value` deliberately not excluded** (renders as the label on
  `<input type="submit|button|reset">`) — literal select/option wire values use inline
  disables instead: `AdminUsersScreen.tsx` (2× `<SelectItem>`, `AssignableRole` ternary)
  and `ModelEditorDialog.tsx` (2× `value`).
- **Callee excludes**: plugin defaults + translator aliases (`t` + PascalCase — repo
  convention: `tErrors`, `tCommon`, `tRoot`, …) + `apiErrorMessage`, `canAdminister`,
  `setEditor`, `toggleSection` (string args are catalog keys / mode tokens).
- **Test files**: rule off (`src/**/*.test.ts(x)`).
- **File allowlist**: `src/components/provider/vendor-icons/marks.tsx` — SVG `<title>`
  brand names (proper nouns).
- **Accepted gap**: plugin `words` excludes let ALL-CAPS and punctuation/emoji pass; a
  supplementary grep over `src/` for ALL-CAPS JSX text and ALL-CAPS
  `placeholder/title/alt/aria-label` values found none.

Guard demo after calibration: exactly 1 error, `i18next/no-literal-string` (see §2).

## 6. AC8 dry-run (throwaway locale `ja`, reverted)

Steps performed: `locales.ts` (+`ja`, +`LOCALE_LABELS.ja`) → `messages/ja.json` (copy of
en) → `defaults.ts` `DEFAULT_MESSAGES` → `render-with-intl.tsx` test `MESSAGES`.

Observed forced registration points:

1. `pnpm typecheck` failed until **two** more locales existed:
   `src/i18n/defaults.ts(19,14): Property 'ja' is missing … Record<"en" | "zh-CN" | "ja",
   LocalizedDefaults>` and `src/test-utils/render-with-intl.tsx(10,7): Property 'ja' is
   missing … Record<…, AbstractIntlMessages>`. (`LOCALE_LABELS` is forced the same way,
   in the same file as the `locales` code.)
2. With a verbatim `en.json` copy, `src/i18n/defaults.test.ts` failed
   `DEFAULT_TOPIC_TITLES > covers every supported locale exactly once`
   (`expected 2 to be 3`) — the new locale's `Chat.newTopic` / `Assistant.defaultName`
   sentinels must be translated, not duplicated.
3. After translating those two values: `pnpm typecheck` and the i18n tests passed
   (15/15 across `defaults.test.ts` + `locales.test.ts`). No component edits needed —
   `LocaleControl` maps over `locales` and `request.ts` imports the catalog dynamically.

Everything reverted; `git status` for the touched files is clean (only the intentional
catalog additions remain). The steps are documented in
`.trellis/spec/frontend/i18n.md` §"Adding a locale".

## 7. Remaining manual checks (browser-only)

- [ ] Settings → General locale switcher: pick 简体中文 / English — the UI re-renders
      without a manual reload, URL unchanged, cookie `NEXT_LOCALE` persists after reload.
- [ ] Visual pass over all primary screens in `en` and `zh-CN` (sign-in/up, setup,
      sidebar + assistant tree, chat + composer + pickers, message actions, topic
      rename/delete, settings: general/account/providers/search/users, admin users) —
      check for clipped/overflowing Chinese text and leftover English.
- [ ] Live error paths in the browser: trigger an API failure (e.g. invalid provider
      key) and confirm the toast/error text is localized via the `Errors` catalog.
- [ ] Emoji picker in the assistant editor: empty state ("No emoji found." /
      "未找到表情") and footer hint ("Select an emoji…" / "选择一个表情…").

## 8. Notes on tree state

- Another writer touched `eslint.config.mjs`, `AdminUsersScreen.tsx`, and
  `ModelEditorDialog.tsx` at ~17:34 (after the test/build evidence): `value` was removed
  from the attribute excludes in favour of inline disables at the literal select sites.
  Lint + typecheck were re-run after that edit and are green; the test/build results are
  unaffected because the post-evidence edits are comments + lint config only.
- `.trellis/.template-hashes.json` was already modified before this task started and was
  not touched by this work.
