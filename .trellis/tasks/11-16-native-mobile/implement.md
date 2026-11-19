# Implement — Android shell

Branch `feat/native-mobile`, cut from `feat/native-desktop-local` (unmerged).

Process:
- implement with Sonnet 5.5;
- check with Opus 5.5;
- then ponytail-review;
- commit only after the user says so.

## Ordered checklist

### 1. shell-ui contract (rollback point A)
- [x] `host.ts`: move `openLocalLog` / `getLocalError` / `getHotkey` / `setHotkey` under optional `desktop`.
- [x] shell-ui `main.ts` gating per design. Add an `./app` export for the entry module in `package.json`.
- [x] Desktop `preload-shell.ts` nests the methods.
- [x] Gate: `pnpm -C native -r typecheck && pnpm -C native -r test`. Desktop smoke: list, welcome, local row and hotkey are unchanged.

### 2. Toolchain + scaffold + spike (rollback point B)
- [x] Install Temurin 21 and cmdline-tools/SDK/emulator under the user's home, then create an API 36 AVD. Record the commands in the mobile README.
- [x] `native/mobile`:
  - package.json, capacitor.config.ts (`appId`, `webDir: dist`, SystemBars `initialViewportFitValueHint: "cover"`);
  - vite config, `index.html`, `src/main.ts`;
  - add it to `native/pnpm-workspace.yaml`;
  - `npx cap add android`, then commit `android/` (gitignore build outputs).
- [x] **Spike on the emulator before building on it.** Confirm or refute the research UNVERIFIED items and record the results in `research/capacitor-android.md`:
  - (a) the serialized format of `theme-color` (oklch?);
  - (b) `addWebMessageListener` / `addDocumentStartJavaScript` work after a runtime `loadUrl` to an http LAN origin and survive remote redirects;
  - (c) passthrough insets plus IME resize keep the composer visible;
  - (d) `copyBackForwardList` contains Next.js pushState entries;
  - (e) `document.hasFocus()` / `visibilityState` when the activity is paused, which decides whether `notify` fires.
  Adjust design.md if anything differs.

### 3. Native shell
- [x] `PikaHostPlugin`: storage, saveServer/removeServer/listServers, connect (feature check, injection registration), shouldOverrideLoad, downloads.
- [x] Injected scripts (pikaNative, theme) and listener validation.
- [x] `MainActivity`: edge-to-edge, colour apply and re-apply on config change, back callback, notification channel/permission/intent handling, renderer recovery, load-error → `?failed`.
- [x] Native server picker dialog (M2).
- [x] `Updates.kt` with silent and manual checks.
- [x] `res/values` + `values-zh-rCN` strings; adaptive icon; monochrome notification icon; `usesCleartextTraffic`.
- [x] shell-ui CSS: `viewport-fit=cover` meta and safe-area padding (harmless on desktop).
- [x] `build.gradle`: version from root package.json, env-gated release signing.

### 4. Web tweak
- [x] `SidebarUserMenu` hides the shortcut on Android, with a test.
- [x] Gate: `pnpm lint && pnpm typecheck && pnpm test` (root).

### 5. Release / CI / docs
- [x] `release.yml` `build-android`; `create-release` needs and attaches it.
- [x] `ci.yml` `android` job (`assembleDebug`).
- [x] Generate the release keystore with `keytool` outside the repo (`~/.pika-chat-keys/`). **User still has to back it up and set the two repo secrets** (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`).
- [x] README (en + zh-CN) Android section: install APK, unknown-sources prompt, background-notification limit (M3), WebView requirement.
- [x] `native/mobile/README.md`: dev toolchain and build/run loop.
- [x] Spec `guides/native-shell.md`: Android model, `desktop?` host group, injection rules, back, bars, release job.

## Validation

- `pnpm -C native -r typecheck && pnpm -C native -r test`
- `pnpm -C native/mobile build && npx cap sync android && (cd native/mobile/android && ./gradlew assembleDebug)`
- Emulator smoke against a local `pnpm dev` server reached at `http://10.0.2.2:3000`, covering every PRD acceptance item that is testable without a tag. Check `window.pikaNative` absence via `chrome://inspect`. Test with gesture nav and 3-button nav (`adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton`).
- Root gates for the web tweak; desktop smoke for the shell-ui contract change.
- Deferred to rc tag: the signed release APK in CI, release attachment, the update check against a real newer release, and the user's physical-phone check.

## Review gates

- After step 2: spike results reviewed, and design adjusted before step 3.
- After step 5: trellis-check (Opus) on the full diff, then ponytail-review, then report to the user.
