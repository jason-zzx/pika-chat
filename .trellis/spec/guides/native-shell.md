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
interface PikaNative {
  serverName: string; // display name of the server this page belongs to
  notify(input: { title: string; body: string; path: string }): void;
  showServerMenu(anchor: { x: number; y: number }): void; // viewport CSS px
  openServers(screen: "list" | "add"): void;
}
```

- Declared once, in `src/global.d.ts`. UI code reads it through
  `usePikaNative()` (`src/hooks/use-pika-native.ts`: `useSyncExternalStore`, `null`
  server snapshot, so hydration never mismatches); `ChatPoolBridge` also reads it
  directly to call `notify` when a reply finishes (not aborted, not
  disconnected) while the page is hidden or unfocused. Always handle it being
  absent (undefined in a browser). No Web Notification fallback.
- Server switching: the sidebar brand row (`AssistantTree`), the account menu
  (`SidebarUserMenu`, "Switch server…" + shortcut) and the auth layout chip
  (`DesktopServerChip`) render only when the bridge exists. `showServerMenu`
  pops a **native** menu in main (saved servers as radio items, Add server…,
  Manage servers…), so the remote page never receives the list of other
  servers. Picking another server loads shell-ui with `?connect=<id>` (normal
  health/version flow); Add / Manage load `?add` / `?list`. `openServers` loads
  `?list` / `?add` directly.
- `serverName` reaches the sandboxed preload via
  `webPreferences.additionalArguments` (`--pika-server-name=<encodeURIComponent>`).
- `path` is an app-relative path (`assistantTopicHref(...)`); it must start
  with `/`.
- Desktop main accepts `native:notify`, `native:showServerMenu` and
  `native:openServers` only when the sender frame origin equals
  the active server origin (payloads zod-validated); clicking the notification focuses the window and
  navigates to `origin + path`.
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
methods (`openLocalLog`, `getLocalError`, `getHotkey`, `setHotkey`) live under the
optional `host.desktop` group; without it shell-ui hides the local row, welcome
screen and hotkey setting, falls back to the list for `local` ids, and opens the
add form on first launch. Main validates every IPC payload at the handler and answers
only the shell view. Connection logic (health check, version warning, URL
normalization) lives in shell-ui so Android can reuse it. Query modes of
`index.html`: none (auto-connect to the last server, `"local"` included, or show
the welcome screen when there is nothing to auto-connect to and `servers` is
empty), `?list`, `?add` (add form;
Cancel returns to the list), `?connect=<id>` (connect flow for that server
regardless of the last one, including `"local"`), `?failed=<id>` (load-error
screen, or local startup error with "Open log" when `id === "local"`). An unknown
id falls back to the list; only an empty query auto-connects or shows the welcome
screen.

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
- **`pikaNative` injection**: `addWebMessageListener("pikaNativeHost", {origin})` plus a
  document-start script that defines the frozen `window.pikaNative` (main frame only,
  `serverName` embedded as a literal), re-registered on every `connect`. The handler also
  checks `sourceOrigin == connected origin` and `isMainFrame`, and validates payloads with
  the desktop limits. Do not remove a web-message listener that is not followed by a new
  one: dropping the connected origin on server removal only clears the accepted origin
  (`RemoteBridge.clearNative`), because unregistering without re-adding crashed WebView 133
  on the next page load.
- **Navigation**: `PikaHostPlugin.shouldOverrideLoad` replaces Capacitor's static
  `allowNavigation`: connected origin stays in the WebView; `https://localhost` (shell-ui) is
  reachable only from shell-ui itself (native code shows it with `loadUrl`, which bypasses the
  hook), so a remote page cannot navigate to it; same-origin `/api/files/<id>` is **opened**
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
  `DownloadListener` also downloads only connected-origin URLs. Editing the connected server keeps
  its old origin until the next `connect` (as on desktop). Main-frame load errors on the connected
  origin (except `net::ERR_ABORTED`) load shell-ui `?failed=<id>`; a lost renderer calls `recreate()`.
- **Back** is an `OnBackPressedCallback`: previous history entry on the connected origin ->
  `goBack()`, otherwise shell-ui `?list`; on shell-ui it disables itself so the system
  backgrounds the app. `@capacitor/app` is deliberately not installed.
- **System bars**: edge-to-edge via `WindowCompat.enableEdgeToEdge` after `super.onCreate`,
  `isNavigationBarContrastEnforced = false`. A theme script (listener `pikaThemeHost`, rules
  `{origin, https://localhost}`) reads `meta[name=theme-color]` (falling back to the body
  background; WebView 133 serializes oklch tokens as `lab()`), normalizes to `#rrggbb` through
  a canvas, and observes the meta, `<html>` class/`data-theme` and `prefers-color-scheme`.
  The colour paints the decor view and WebView background and picks light/dark bar icons by
  luminance; it is re-applied after `onConfigurationChanged` because Capacitor's SystemBars
  resets the decor background there; it is sent on `DOMContentLoaded` and `load` (shell-ui's CSS arrives
  late). SystemBars runs with `insetsHandling: "native"` so Capacitor never writes
  `--safe-area-inset-*` onto remote pages (it caused a dev hydration mismatch on `<html>`). On WebView < 140 the plugin pads the decor
  view by the bar insets (`env(safe-area-inset-*)` is 0), which the page background shows
  through; the IME resizes the viewport.
- **Notifications**: channel `replies`; `POST_NOTIFICATIONS` requested once after the first
  successful remote page load; the tap intent carries `serverId` + `path` and `onNewIntent`
  loads `origin + path` only when that server is still connected. No foreground service: Android
  freezes a backgrounded app after about 10 s, so a completion notification appears only
  while the app is in front or just after leaving it.
- **Updates**: `Updates.kt` queries the GitHub latest release (silent at launch, dialog on
  manual check from shell-ui settings).
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
- Secrets and storage: `<userData>/local/` holds `db/`, `files/`, `server.log`,
  and `secrets.bin` (`BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_SECRET`,
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
  `parentPort`, waiting up to 5 s for PGlite to close before killing. An update
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
  pglite) is loaded only through its Turbopack alias
  (`.next/node_modules/<pkg>-<hash>`), which is already a full copy, so hoisting
  it as well would ship it twice (~20 MB). Mac release builds split
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
- Updates: electron-updater (GitHub provider) on Windows NSIS and Linux
  AppImage/deb/rpm (deb/rpm elevate via pkexec); macOS only prompts with the
  release link. Builds are unsigned (macOS ad-hoc).
- Keep the Linux target order AppImage, deb, rpm: electron-builder writes
  `resources/package-type` into the shared `linux-unpacked` dir for deb/rpm, so
  AppImage must be packed first or it would pick the wrong updater.
