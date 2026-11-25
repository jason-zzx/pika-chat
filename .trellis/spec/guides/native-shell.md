# Native Shell

> Contracts between the web app and the native shells under `native/`
> (Electron desktop and Android). Task context:
> `.trellis/tasks/11-16-native-apps`.

---

## Model

The shell loads the deployed server's web app as a top-level page (cookies are
first-party; no CORS or `trustedOrigins` change). A bundled `shell-ui` page
handles the server list, connection errors and settings. The web app must work
unchanged in a plain browser: **`window.pikaNative` is optional and must stay
optional.**

## `window.pikaNative` (web <-> host)

```ts
interface PikaNativeNavigation {
  setCanGoBack(canGoBack: boolean): void;
  onBack(listener: () => void): () => void;
}

interface PikaNative {
  serverName: string; // display name of the server this page belongs to
  appVersion?: string; // native shell version (optional for older shells)
  connectedSince?: number; // epoch ms the shell last switched to this server (optional for older shells)
  notify(input: { title: string; body: string; path: string }): void;
  showServerMenu(anchor: { x: number; y: number }): void; // viewport CSS px
  openServers(screen: "list" | "add"): void;
  navigation?: PikaNativeNavigation; // logical Back bridge (optional for older shells/servers)
  desktop?: PikaNativeDesktop; // desktop-only settings, storage, updates, diagnostics
}
```

- Declared once, in `src/global.d.ts`. UI code reads it through
  `usePikaNative()` (`src/hooks/use-pika-native.ts`: `useSyncExternalStore`, `null`
  server snapshot, so hydration never mismatches); `ChatPoolBridge` also reads it
  directly to call `notify` when a reply finishes (not aborted, not
  disconnected) while the page is hidden or unfocused. Sends report through the
  pooled `Chat` `onFinish`; regenerate / edit run a manual stream loop, so they
  report through `noteRegenFinished(topic, terminal)` with the stream's last
  terminal chunk (`finish` / `error` notify, `abort` or none stays silent). Always handle it being
  absent (undefined in a browser). No Web Notification fallback.
- Server switching: the sidebar brand row (`AssistantTree`), the account menu
  (`SidebarUserMenu`, "Switch server…" + shortcut) and the auth layout chip
  (`DesktopServerChip`) render only when the bridge exists. On desktop, `showServerMenu`
  opens a **shell-owned transparent overlay `WebContentsView`** (`?chrome=menu` inside
  `win.contentView`, styled with the active page's synced theme colors; saved servers
  with right-aligned checkmark, Add server…, Manage servers…), so the remote page never
  receives the list of other servers. Picking another server loads shell-ui with
  `?connect=<id>` (normal health/version flow); Add / Manage load `?add` / `?list`.
  `openServers` loads `?list` / `?add` directly.
- Desktop settings, storage & diagnostics (`pikaNative.desktop`): rendered inside
  `Settings -> General` (`DesktopSettingsSection`) and `Settings -> About` (`AboutVersionCard`)
  only when `native.desktop` is present. Covers `closeAction` (`"tray"` default / `"quit"`
  on Win/Linux), global shortcut, 4-category storage breakdown (`localDataBytes`, `webCacheBytes`,
  `updaterCacheBytes`, `logsAndTempBytes`) with safe cache/log clearing, manual update checks,
  and a 5-click version trigger that activates `developerMode` (without auto-opening DevTools)
  to expose on-demand detached DevTools and `desktop.log`.
- Theme & frameless titlebar: Windows and Linux use `frame: false` (macOS `hiddenInset`) with
  a 34 px `titlebarView` (`?chrome=titlebar`, collapsed in fullscreen). `preload-remote.ts`
  observes `meta[name="theme-color"]`, `<html>` theme/class, `(min-width: 768px)`, and sidebar
  layout changes (`pika:chrome-sync` / navigation), sampling `--background`, `--sidebar`,
  `--popover`, `--accent`, `--border`, etc. and posting `native:theme` (origin-checked). Because
  `AppSidebar` uses `variant="inset"` across both web and desktop (with `data-chrome="desktop"`
  making the inset card sit flush beneath the 34 px titlebar), the sidebar and borderless
  `--sidebar` titlebar form one seamless frame around the inset content card (falling back to
  `--background` + border on auth pages, `shell-ui`, and narrow `< 768px` windows).
- `serverName` reaches the sandboxed preload via
  `webPreferences.additionalArguments` (`--pika-server-name=<encodeURIComponent>`).
- `connectedSince` marks where the current stay on a server began, so composer drafts
  do not survive a server switch (the web app drops drafts with an older `updatedAt`).
  It changes only when a connect targets a server other than `lastServerId`.
  Reconnecting the same server, reloading, or restarting the app keeps it. Desktop
  persists it in `config.json` (set in `attachServerView`, passed as
  `--pika-connected-since=<ms>`). Android stores it as the `connected_since` pref, written
  in `PikaHostPlugin.connect`, and embeds it as a literal in the `RemoteBridge` script.
  Removing the last server nulls `lastServerId`, so the next connect always starts a new stay.
- `path` is an app-relative path (`assistantTopicHref(...)`); it must start
  with `/`.
- Desktop main accepts `native:notify`, `native:showServerMenu`, `native:openServers`,
  `native:theme`, `native:navState`, and `native:desktop:*` only when the sender frame origin equals
  the active server origin (payloads zod-validated); clicking a notification focuses the window,
  re-attaches `remote.view` if hidden behind `shellView`, and navigates to `origin + path`.
- Native navigation (`pikaNative.navigation`): `NavigationProvider` owns a logical stack
  (`src/lib/navigation-state.ts`, persisted in `sessionStorage`) and uses `router.replace`
  in native mode so Chromium's history stays flat, Home (`/`) is always the workspace root,
  and `/settings/*` is an isolated branch. Back events (`native:back` on Desktop,
  `window.__pikaDispatchBack?.()` on Android) dismiss the topmost Base UI overlay first
  (`src/lib/overlay-dismiss.ts`) before stepping the stack. Desktop hooks `app-command`
  (`browser-backward`), macOS `swipe`, and `before-input-event` (`Alt+Left` / `Cmd+[` /
  `BrowserBack`, swallowing forward shortcuts) with root Back as a no-op; `showShell` keeps
  `remote.view` alive unless `dropRemote: true` so `returnToServer()` resumes losslessly.
  Both shells gate logical Back dispatch on `webNavReady` (flipped on the first `navState`
  message) and fall back to same-origin `goBack()` when connecting to older servers.
- Adding a method: extend the type in `src/global.d.ts`, the remote preload,
  and the main-process handler (with its origin check) together.

## `/api/health` and compatibility

`GET /api/health` returns `{ ok: true, version }`, `version` imported from root
`package.json`. The shell compares major.minor with its own version; a
mismatch (or a missing `version` from an older server) is a non-blocking
warning before connecting. Existing callers only read `ok`.

## `window.pikaShell` (shell-ui <-> host)

Defined in `native/shell-ui/src/host.ts`, implemented by the desktop
`preload-shell.ts` and the Android host (`native/mobile/src/main.ts`). Desktop-only
methods (`openLocalLog`, `getLocalError`, `setTheme`, `getDeveloperMode`,
`setDeveloperMode`, `openDevTools`, `openDesktopLog`, `windowControls`, `serverMenu`)
live under the optional `host.desktop` group; without it shell-ui hides the local row
and welcome screen and opens the add form on first launch. On both desktop and Android,
shell-ui keeps only server management (no Settings screen in the server list) and renders a
subtle footer showing the app version and a "Check for updates" action (on desktop, clicking
the version 5 times activates `developerMode` without auto-opening DevTools). When
`host.desktop` is present, shell-ui also renders `?chrome=titlebar` and `?chrome=menu`. Main
validates every IPC payload at the handler and answers
only the matching shell view. Connection logic (health check, version warning, URL
normalization) lives in shell-ui so Android can reuse it. query modes of `index.html`: none (auto-connect to the last server, `"local"` included, or show
the welcome screen when there is nothing to auto-connect to and `servers` is
empty), `?list`, `?add` (add form; Cancel/Back returns to the active server when opened standalone,
otherwise pops to the list), `?connect=<id>` (connect flow for that server
regardless of the last one, including `"local"`), `?failed=<id>` (load-error
screen, or local startup error with "Open log" when `id === "local"`),
`?chrome=titlebar` (desktop frameless top bar), and `?chrome=menu` (desktop
server switcher overlay).

Appearance: shell-ui imports the web app's `src/app/theme-tokens.css` (no hand-copied
tokens) and mirrors the **last connected server's** theme preference. Both shells' remote
theme observers read the page's `pika_theme` cookie (`mode:resolved:preset`) and forward
`mode` / `preset` as extra fields of the existing theme payload (desktop `native:theme`, whose
`themeInput` strips them from `remote.theme`; Android `pikaThemeHost`). The host validates it (mode enum, preset `^[a-z0-9-]{1,32}$`, not
enumerated so newer server presets pass) and persists it (`config.json` `appearance` /
`SharedPreferences` `appearance_mode` + `appearance_preset`, default `system` + `default`).
**The host, not shell-ui, applies it, before the shell page's first frame**: it sets
`data-theme=<preset>` (unknown or `default` match no preset block and fall back to the base
tokens) and toggles `.dark` (`system` follows `prefers-color-scheme` live). Desktop
`preload-shell.ts` reads it with `sendSync("shell:getAppearance")` (shell pages only, not
`?chrome=`) and applies it from a `MutationObserver` on `document`, because `documentElement`
is still `null` when a preload runs; Android registers a shell-origin document-start script
(`MainActivity.installShellAppearance`, re-registered whenever the stored appearance changes,
since shell-ui reloads on every `showShell`). Do not move this back into an async shell-ui
call: the launch auto-connect detaches/hides the shell while its last frame (and Android's
`DOMContentLoaded` theme sample) would still follow the OS scheme, and the first `showShell`
flashes that stale frame. The shell `index.html` files deliberately have no
`<meta name="color-scheme">`: it would make Android's pre-CSS canvas follow the OS instead of
the WebView background the host set. shell-ui only reads the `.dark` class when reporting its sampled
colors. Showing the shell from a server page must not reveal the shell view's previous document either
(painted with the appearance it had then): desktop `showShell` replaces the detached `shellView`
with a fresh `WebContentsView` (background = the server's palette, which the shell mirrors);
Android keeps `remoteWebView` on screen with the shell WebView `INVISIBLE` (background =
`remoteTheme`) and reveals it in the bridge listener's `onPageCommitVisible`, after which
WebView never draws the previous document. The hosts also pick the pre-paint window / bar default from the stored mode.
Connecting to a remote server whose origin has no `pika_theme` cookie yet seeds one
(`mode:resolved:preset` from the stored appearance, `Path=/`, 1 year, `SameSite=Lax`) so its
sign-in page matches the shell; after sign-in the account's DB preference rewrites it. A mode
change that toggles no class (`system` → `dark` on a dark OS) is still caught because
`persistTheme` always rewrites `meta[name=theme-color]`; the observers run in a later
microtask, after it has also written the cookie. `listServers()` includes `activeServerId` when a kept-alive server
can be resumed via `returnToServer()`; `shell-ui` tracks an internal sub-screen stack
(`native/shell-ui/src/nav-stack.ts`), handles `onBack` / `Escape` (confirm `<dialog>` first),
and reports `setCanGoBack`. Removing the active server or changing its normalized URL origin
immediately drops the kept-alive server; editing only its name keeps it returnable. An unknown id
falls back to the list; only an empty query auto-connects or shows the welcome screen.

## Android shell (`native/mobile`, remote mode only)

- Capacitor 8 (minSdk 24, target/compileSdk 36, JDK 21). Capacitor provides the
  shell-ui bridge, the WebView file chooser / camera permissions and build tooling;
  everything the remote page needs is hand-written Kotlin, because remote pages never
  get the Capacitor bridge. Package `io.github.jasonzzx.pikachat`; `versionName` is the
  root `package.json` version and `versionCode` = `major*10000 + minor*100 + patch`.
- **Server list** lives in `SharedPreferences("pika")` (`PikaHostPlugin`); `saveServer`
  re-normalizes the URL natively. Health checks use `CapacitorHttp` (no CORS). `connect`
  requires androidx.webkit `WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT`, otherwise it
  rejects with an "update Android System WebView" error; there is no `addJavascriptInterface`
  fallback. Removing a server expires that origin's cookies. Web storage is **not** cleared:
  `WebStorage.deleteOrigin` is a no-op on current WebViews (checked on 133).
- **Dual WebViews & `pikaNative` injection**: Capacitor's `bridge.webView` stays exclusively
  on `https://localhost` (`shell-ui`) so `PikaHostPlugin` and `CapacitorHttp` never lose the
  bridge. Each `connect` destroys any previous `remoteWebView` (guaranteeing empty history and
  avoiding WebView 133 crashes from removing a `WebMessageListener` without re-adding one) and
  creates a fresh `remoteWebView` inside the root `CoordinatorLayout`, reusing a single
  `BridgeWebChromeClient(bridge)` created in `onCreate` before `STARTED`. Each `remoteWebView`
  installs a per-view `RemoteBridge` (`addWebMessageListener("pikaNativeHost", {origin})` +
  document-start script defining frozen `window.pikaNative` with `navigation`, main frame only,
  `serverName` embedded as a literal). The handler checks `sourceOrigin == origin`, `isMainFrame`,
  and `isCurrentRemoteBridge(this)`, validating payloads with the desktop limits. Opening
  `shell-ui` (`showShell(query, dropRemote = false)`) hides `remoteWebView` (`View.INVISIBLE`)
  without destroying it so `returnToServer()` restores it losslessly; removing the active server
  or editing its URL origin destroys `remoteWebView` immediately.
- **Navigation**: `PikaHostPlugin.shouldOverrideLoad` handles `bridge.webView` (`shell-ui` only),
  while `shouldOverrideRemoteLoad` handles `remoteWebView`: connected origin stays in the WebView;
  `https://localhost` (shell-ui) is always blocked from `remoteWebView`; same-origin `/api/files/<id>` is **opened**
  (`openAttachment`: GET with the session cookie, no redirects; on 3xx GET `Location` without the cookie; saved to
  `cacheDir/open` (cleared on start), then an `ACTION_VIEW` "Open with" chooser on a FileProvider Uri;
  `<queries>` for `VIEW content:*/*` is needed or `resolveActivity` is null; no `REQUEST_INSTALL_PACKAGES`),
  while the `download` message and the `DownloadListener` **download** (`PikaHostPlugin.download`: `HEAD` probe with
  the session cookie and no redirects; 2xx enqueues the URL with the cookie and the `Content-Disposition` filename,
  3xx enqueues the presigned `Location` without the cookie and takes the name from its
  `response-content-disposition`; the system notification stays and an `ACTION_DOWNLOAD_COMPLETE` receiver toasts
  "Downloaded <name>" / "Download failed"; probe failures toast too),
  other http(s) goes to `ACTION_VIEW`. A click on `a[download]` to `/api/files/<id>` never reaches
  that hook (WebView follows the 302 straight to the storage host), so the injected `pikaNative` script captures it
  and posts `{type:"download", url}`; native re-checks with `PikaHostPlugin.downloadAttachment`. The
  `DownloadListener` also downloads only connected-origin URLs. Main-frame load errors on the connected
  origin (except `net::ERR_ABORTED`) load shell-ui `?failed=<id>` with `dropRemote = true` (or silently
  drop `remoteWebView` if `shell-ui` is already foregrounded); a lost foreground renderer calls `recreate()`.
- **Back & predictive back**: `AndroidManifest.xml` enables `android:enableOnBackInvokedCallback="true"`.
  `MainActivity.updateBackEnabled()` dynamically toggles a single `OnBackPressedCallback` from
  `(serverMenuDialog?.isShowing -> false; isShellVisible -> shellCanGoBack; remoteWebView != null -> if (webNavReady) webCanGoBack else canGoBack())`.
  At root with no open overlays the callback is disabled so Android 14+ OS drives the predictive
  back gesture directly to the launcher. `@capacitor/app` is deliberately not installed.
- **System bars & themed server menu**: edge-to-edge via `WindowCompat.enableEdgeToEdge` after `super.onCreate`,
  `isNavigationBarContrastEnforced = false`. Separate `shellTheme` and `remoteTheme` palettes are
  tracked via `RemoteBridge.installTheme` (`pikaThemeHost` scoped to each WebView's single origin),
  so background theme events never flicker the system bars. The script reads `meta[name=theme-color]` (falling back to `--background` / body
  background; WebView 133 serializes oklch tokens as `lab()`) plus dialog tokens (`--popover`,
  `--popover-foreground`/`--foreground`, `--muted-foreground`, `--accent`, `--primary`, `--border`),
  normalizes via a canvas (`#rrggbb` / `#aarrggbb`), and observes the meta, `<html>` `class`/`data-theme`/`style`
  and `prefers-color-scheme`. `MainActivity.applyBarColor` paints the decor view, picks
  light/dark bar icons by luminance, and `activeTheme` styles the native `AlertDialog`
  server menu (`ServerMenuDialog.kt`). The bar colour is re-applied after `onConfigurationChanged` because Capacitor's SystemBars
  resets the decor background there; theme payloads are sent on `DOMContentLoaded` and `load` (shell-ui's CSS arrives
  late). SystemBars runs with `insetsHandling: "native"` so Capacitor never writes
  `--safe-area-inset-*` onto remote pages (it caused a dev hydration mismatch on `<html>`). Because
  `remoteWebView` is added to the same `CoordinatorLayout` parent inside the decor view and calls
  `requestApplyInsets()`, both WebViews inherit the same safe-area / IME resize behavior.
- **Notifications**: channel `replies`; `POST_NOTIFICATIONS` requested once after the first
  successful remote page load; the tap intent carries `serverId` + `path` and `onNewIntent`
  loads `origin + path` only when that server is still connected. No foreground service: Android
  freezes a backgrounded app after about 10 s, so a completion notification appears only
  while the app is in front or just after leaving it.
- **Updates**: `Updates.kt` queries the GitHub latest release on manual check from the
  shell-ui footer (no automatic check at launch).
- **Dev testing**: the Next dev server 403s chunk requests from an unlisted host such as
  `10.0.2.2`, so the page never hydrates; `adb reverse tcp:3000 tcp:3000` and a
  `http://localhost:3000` server avoid it (see `native/mobile/README.md`).
- **Release**: `release.yml` `build-android` signs with `ANDROID_KEYSTORE_BASE64` (decoded to a
  PKCS12 file) and `ANDROID_KEYSTORE_PASSWORD` (key password = store password, alias
  `pika-chat`), uploads `Pika-Chat-<version>.apk`; `create-release` needs and attaches it.
  `ci.yml` `android` builds the unsigned debug APK.

## Local mode (`LOCAL_MODE=1`, desktop only)

- Electron main (`native/desktop/src/local-server.ts`) forks the bundled Next
  standalone server (`resources/server/server.js`, outside `asar`) via
  `utilityProcess.fork` on `127.0.0.1` only. The child gets an env **allowlist**
  (`PATH`, `HOME`, `USERPROFILE`, temp vars, `SystemRoot`, `LANG`, `TZ`) plus the
  explicit local-mode vars; never spread `process.env`, or a user's `S3_*` /
  `DEMO_MODE` / `NODE_OPTIONS` would reconfigure or break the local server.
- Port selection: the first launch probes `127.0.0.1:0`, saves `localPort` in
  `config.json`, and reuses it on later starts unless it is already taken, so
  origin-scoped `localStorage` (drafts, composer settings, sidebar state)
  survives restarts.
- Secrets and storage: `<userData>/local/` holds `pika-chat.db` (+ `-wal` /
  `-shm`), `files/`, `server.log`, and `secrets.bin` (`BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_SECRET`,
  `LOCAL_ADMIN_PASSWORD` encrypted with Electron `safeStorage`). Decryption
  failure surfaces as a shell error and never silently regenerates secrets.
- Session and lifecycle: `connect("local")` waits for `/api/health`, signs into
  partition `persist:local` via `/api/auth/sign-in/username` as `local`, and
  intercepts any main-frame `/sign-in` or `/setup` navigation back to silent
  sign-in. All three events are needed: server `redirect()` arrives as
  `will-redirect`, client router pushes as `did-navigate-in-page`, and
  `location.replace()` as `will-navigate`. Switching
  to a remote server or closing to tray leaves the local server running so
  background generations finish; `before-quit` posts `"shutdown"` over
  `parentPort`, waiting up to 5 s for the server to close SQLite before
  killing. An update
  install shuts the local server down **before** `quitAndInstall()`: the NSIS
  installer starts inside that call and force-kills every `Pika Chat.exe`
  (utility processes included) within ~2.6 s, and the server's open files would
  block the overwrite.
- Packaging: `native/desktop/scripts/build-server.mjs` copies `.next/standalone`,
  `.next/static`, `public`, and `src/server/db/migrations`, flattening pnpm's
  `.pnpm` store into a plain `node_modules` (conflicting versions nested under
  their dependant) and resolving every symlink by hand, because `fs.cpSync`'s
  `dereference` does not follow symlinks nested in a copied directory and
  `extraResources` / Windows installers cannot keep them. It skips `.env*`:
  Next copies the developer's `.env` into standalone, which would ship
  `DATABASE_URL`, secrets and S3 keys inside a locally built installer. Only
  packages something links to are hoisted: a package nothing links to (e.g.
  `better-sqlite3`) is loaded only through its Turbopack alias
  (`.next/node_modules/<pkg>-<hash>`), which is already a full copy, so hoisting
  it as well would ship it twice. Nothing is recompiled: `better-sqlite3` is
  an N-API addon whose bundled prebuild for the host OS/arch loads in Electron
  as-is. The script fails the build unless an `ELECTRON_RUN_AS_NODE=1` smoke
  check can load every bundled copy and query `:memory:` — see
  [Local Mode](../backend/local-mode.md). `pnpm -C native install` must run
  before it. Mac release builds split
  into `macos-15-intel` (`--x64`) and `macos-latest` (`--arm64`) because `sharp`
  native binaries are arch-specific.

## Navigation rule: no in-app browser windows

The desktop app never opens a second in-app window. `window.open` /
`target="_blank"` is always denied: same-origin `/api/files/<id>` is downloaded
with the server session and opened in the OS default app — only for the
document/media extensions in `OPENABLE_EXTENSIONS` (`native/desktop/src/main.ts`);
any other type (the server accepts scripts like `.bat`/`.js`/`.ps1`/`.py`/`.sh`)
is only revealed with `shell.showItemInFolder`, because `openPath` would execute
it on Windows. Keep that allowlist in step with `src/lib/files/media-types.ts`
when adding openable types. Other same-origin
URLs are ignored; other origins go to the system browser. `will-navigate` to
another origin is redirected to the system browser. Permissions: only
`clipboard-sanitized-write` is granted.

Focus is part of the notify contract: the remote view uses
`backgroundThrottling: false`, so its `visibilityState` stays `visible` while the
window is hidden or minimized; main must keep the attached view's webContents
focused whenever the window is (on attach and on window `focus`), otherwise
`document.hasFocus()` is false while the user is looking at the app and
notifications fire spuriously.

macOS builds use `mac.identity: "-"` (ad-hoc) with `hardenedRuntime: false`;
`identity: null` skips signing and the arm64 build would not launch.

## Workspace isolation

`native/` is its own pnpm workspace (own `pnpm-workspace.yaml` and
`pnpm-lock.yaml`). The root `tsconfig.json`, `.dockerignore`, and `.gitignore`
exclude it, so root lint/typecheck/test and the Docker image are unaffected.
Run native commands with `pnpm -C native ...`. electron 45 has no postinstall
script (the binary downloads lazily on first run; electron-builder fetches its
own), so `allowBuilds` needs only `esbuild`.

## Versioning and release

- Single source of truth: root `package.json` `version`. The desktop build
  injects it (esbuild `define`, electron-builder `extraMetadata.version`).
  The release job fails when `v<package.json version>` differs from the tag.
- `release.yml`: `build-desktop` (ubuntu/windows/macos matrix, needs
  `quality-gate`) uploads one artifact per OS; `create-release` needs
  `[build-and-push, build-desktop]` and attaches everything, so one tag yields
  one release with the Docker image and desktop installers. Tags containing
  `-` are prereleases. `ci.yml` has a `native` job (typecheck, tests, bundle).
- Updates: electron-updater (GitHub provider) on Windows NSIS (`oneClick: false`,
  `allowToChangeInstallationDirectory: true`, `installer.nsh` cleaning updater cache and
  optional `%AppData%` wipe checkbox on real uninstall) and Linux AppImage/deb/rpm
  (deb/rpm elevate via pkexec); Windows portable `.zip` (shares `%AppData%` `userData`)
  and macOS prompt with the release link (`supportsAutoInstall()` checks both
  `app-update.yml` and `Uninstall Pika Chat.exe` on `win32`). Windows CI runs
  `--win zip --x64` before `--win nsis --x64` so `PublishManager` does not write
  `app-update.yml` into the portable `.zip`. Builds are unsigned (macOS ad-hoc).
- Linux icons: `linux.icon: "icons"` points at `native/desktop/assets/icons/`
  (`16x16`–`512x512` PNGs) so `FpmTarget` installs standard `hicolor` sizes indexed by
  `/usr/share/icons/hicolor/index.theme` (a single `1024x1024` PNG bypassed icon-set
  generation and missed `hicolor` lookup). Keep the Linux target order AppImage, deb, rpm:
  electron-builder writes `resources/package-type` into the shared `linux-unpacked` dir
  for deb/rpm, so AppImage must be packed first or it would pick the wrong updater.
