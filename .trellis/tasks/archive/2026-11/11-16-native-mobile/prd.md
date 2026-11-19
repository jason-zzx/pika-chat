# Mobile shell remote mode (Android)

Parent: `11-16-native-apps` (D1, D4, D5, D7; `pikaNative` contract in `.trellis/spec/guides/native-shell.md`).
Depends on: `11-16-native-desktop-local` (shared `native/shell-ui` incl. the local-mode views it must hide on Android). Branch `feat/native-mobile` is cut from `feat/native-desktop-local`.
Design: `design.md`. Plan: `implement.md`. Evidence: `research/capacitor-android.md`.

## Goal

An Android APK, sideloaded from GitHub Releases, that connects to deployed Pika servers and feels like an app rather than a browser tab: theme-coloured system bars, a composer that stays above the keyboard, a working back button, native server switching and completion notifications.

## Decisions

| ID | Decision | Source |
|---|---|---|
| M1 | Capacitor **8** (stable 8.6.x: minSdk 24, target/compileSdk 36, JDK 21). Capacitor 9 is RC only; migrate later in its own task. Capacitor is kept for the shell-ui JS bridge, the WebView file chooser / camera permission handling and build tooling. Everything the remote page needs is hand-written native code, because remote pages never get the Capacitor bridge. | user |
| M2 | "Switch server" (`showServerMenu`) opens a native single-choice dialog: saved servers (current checked), plus "Add server" and "Manage servers". The remote page never receives the server list, the same as the desktop native menu. | user |
| M3 | No foreground service. Android freezes a backgrounded app after about 10 s, so a completion notification appears only when the reply finishes while the app is in front or just after leaving it. Returning to the app reconnects and shows the finished reply (server-owned generation). This limit is documented. | user |
| M4 | Verification: Claude smoke-tests on a KVM emulator, then the user checks on a physical phone over adb. | user |
| M5 | Remote mode only (D1): no "This computer" row, no welcome screen and no hotkey setting on Android. First launch with no servers opens the add-server form. | D1 + default |
| M6 | Package id `io.github.jasonzzx.pikachat` (Android ids cannot contain `-`). The version comes from root `package.json`: `versionName` is the version string, `versionCode` = `major*10000 + minor*100 + patch`. | default |

## Requirements

- R1 **Project:** a Capacitor 8 app in `native/mobile` (a pnpm workspace member) whose web assets are shell-ui plus an Android `pikaShell` host. The `android/` Gradle project is committed. Root lint, typecheck and Docker stay unaffected (parent R2).
- R2 **Server list and connect:**
  - the server list lives natively, and shell-ui talks to it through the `pikaShell` contract;
  - the health check runs through native HTTP, so it is CORS-free; the major.minor version warning works as on desktop;
  - connecting loads the server origin top-level in the WebView;
  - cookies persist across app restarts (flushed when the app pauses);
  - removing a server clears that origin's cookies and web storage.
- R3 **`pikaNative`:**
  - injected only into the connected origin's main frame, with the same API as desktop;
  - native code also rejects messages whose `sourceOrigin` is not the connected origin or that do not come from the main frame;
  - payloads are validated natively, with the same limits as desktop;
  - `showServerMenu` per M2; `openServers` loads shell-ui `?list` / `?add`.
  - If the WebView lacks the required androidx.webkit features, connecting shows an "update Android System WebView" error instead of falling back to an all-origins bridge.
- R4 **Navigation:**
  - full navigations and redirects within the connected origin stay in the app;
  - any other http(s) origin opens in the system browser;
  - same-origin `/api/files/<id>` targets (`window.open` / downloads) are saved with the session cookie through the system DownloadManager, which shows its own notification;
  - a main-frame load failure shows the shell-ui `?failed=<id>` view;
  - a crashed WebView renderer recreates the activity instead of killing the app.
- R5 **Back button:**
  - goes back through WebView history while the previous entry is on the connected origin;
  - otherwise returns to the shell-ui server list;
  - on shell-ui, the default system behaviour applies (the app goes to background).
  - It is built on `OnBackPressedCallback`, so predictive back on Android 16 works.
- R6 **System bars and keyboard:**
  - the app is edge-to-edge on every supported API level;
  - status and navigation bar backgrounds follow the page's live `theme-color` (mode and preset, including oklch values) on remote pages, and the shell-ui background on shell-ui;
  - icon contrast follows the colour's luminance;
  - there is no contrast scrim and no hairline gap at the bottom, including at fractional pixel ratios and after a light/dark change;
  - the composer stays above the soft keyboard, and no ghost padding remains after the keyboard closes.
- R7 **Notifications:**
  - `notify` posts a system notification on an app channel;
  - `POST_NOTIFICATIONS` is requested on Android 13+ after the first successful connect;
  - tapping the notification brings the app to front and opens `origin + path`, but only if that server is still connected; otherwise it only opens the app.
  - Background limit per M3.
- R8 **Updates:**
  - at launch (silent) and from shell-ui settings (manual), the app queries the latest GitHub release;
  - a newer tag shows a native dialog that opens the release page;
  - a manual check reports "up to date" and errors.
- R9 **Release and CI:**
  - on `v*` tags, `release.yml` builds a signed release APK (keystore and passwords from repo secrets) and attaches `Pika-Chat-<version>.apk` to the same release;
  - `create-release` waits for it;
  - `ci.yml` builds an unsigned debug APK so Gradle breakage shows on PRs.
- R10 **Web side (minimal):**
  - the account menu's "Switch server…" shows no keyboard-shortcut hint on Android;
  - the `pikaNative` contract is unchanged;
  - a plain browser behaves exactly as before (parent R5).
- R11 **i18n:** shell-ui strings already cover en and zh-CN; native strings (dialogs, notification channel, WebView error, update prompts) get `values` and `values-zh-rCN` resources.

## Acceptance Criteria

- [ ] Install APK on an emulator (API 36) and a physical phone, add a server, sign in and chat. Force-stopping and reopening the app auto-connects to the last server, still signed in.
- [ ] Add a second server and switch between them through the native dialog from the sidebar brand row, account menu and auth-page chip. Each server keeps its own session.
- [ ] `window.pikaNative` is undefined on any origin other than the connected one, e.g. an external link opened by mistake or shell-ui.
- [ ] Back goes through in-app history, then to the server list, then backgrounds the app.
- [ ] Theme mode and preset changes recolour status and navigation bars live in both light and dark, with gesture nav and with 3-button nav, with no bottom hairline. The keyboard never covers the composer.
- [ ] A reply that finishes while the app is unfocused posts a notification. Tapping it opens the topic. Backgrounding for a long generation and returning shows the finished reply.
- [ ] External links open in the system browser. Uploading an attachment works through the file picker. Opening an attachment downloads it.
- [ ] The manual update check works against GitHub releases.
- [ ] A tag build attaches a signed APK to the release, and PR CI builds the debug APK. Desktop, Docker and the web app are unaffected.

## Open items needing the user

- Release keystore: Claude generates it with `keytool` outside the repo during implementation. It is a PKCS12 keystore whose key password equals the store password, with alias `pika-chat` hardcoded in Gradle. The user backs it up (file + password, outside GitHub) and adds the two repo Actions secrets `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`. Losing the keystore means users must uninstall before they can update.

## Out of Scope

- iOS (PWA only), Play Store, share-target, deep links, remote push, on-device server (D1).
- Foreground service or background streaming (M3).
- Capacitor 9 migration.
