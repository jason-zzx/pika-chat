# Design — Desktop shell remote mode

Builds on parent `11-16-native-apps/design.md`. Decisions from planning:

| ID | Decision |
|---|---|
| DR1 | One active server at a time. Switching destroys the previous server's view; its persistent session (cookies) survives, so switching back needs no sign-in. |
| DR2 | Reply notifications only inside the desktop shell (`window.pikaNative`). No Web Notification fallback for browser/PWA in this task. |
| DR3 | Global hotkey is configurable in shell settings, default `CommandOrControl+Shift+Space`, can be disabled. |
| DR4 | `native/` is its own pnpm workspace (own `pnpm-workspace.yaml` + lockfile), so the root workspace, Dockerfile, and root lockfile are untouched. |
| DR5 | Desktop artifacts are built inside `release.yml` (new matrix job) and attached by the existing `create-release` job; no separate `native.yml`. |
| DR7 | No in-app browser windows: same-origin file links open in the OS default app; everything else external or ignored. |
| DR8 | Linux targets AppImage, deb, rpm; all three update via electron-updater (deb/rpm through pkexec on explicit user action). |
| DR9 | In-page server switching: `pikaNative` gains `serverName`, `showServerMenu(anchor)`, `openServers(screen)`; the server list is rendered as a native `Menu.popup`, so the remote page never sees other servers. |
| DR6 | App version single source = root `package.json` `version`; injected at build time into the shell (esbuild `define`) and electron-builder (`extraMetadata.version`). |

## Layout

```
native/
├── pnpm-workspace.yaml      # packages: shell-ui, desktop; allowBuilds: esbuild
├── pnpm-lock.yaml
├── shell-ui/                # Vite + vanilla TS, no framework
│   ├── index.html
│   └── src/{main.ts, host.ts, servers.ts, i18n.ts, style.css}
└── desktop/
    ├── package.json         # electron, electron-builder, electron-updater, esbuild
    ├── electron-builder.config.mjs
    ├── scripts/build.mjs    # esbuild main + preloads, copies shell-ui dist
    ├── assets/              # app icon (1024 png), tray icons, macOS template icons
    └── src/{main.ts, store.ts, updater.ts, i18n.ts, preload-shell.ts, preload-remote.ts}
```

Root changes: `tsconfig.json` `exclude` adds `native`; `.dockerignore` adds `native`; `.gitignore` adds `native/**/node_modules`, `native/**/dist`, `native/desktop/release`.

TypeScript 5.9.3 (same as root). Main and both preloads are bundled with esbuild to CJS (sandboxed preloads cannot be ESM).

## Process / view model

```
BrowserWindow (frameless? no — native frame)
 ├─ shellView  : WebContentsView  file://…/shell-ui/index.html   preload-shell  (default session)
 └─ remoteView : WebContentsView  https://server/…               preload-remote (persist:server-<id>)
```

- Exactly one of the two views is attached to `window.contentView` at a time; the attached view is resized to the window's content bounds on `resize`.
- `connect(id)`: destroy existing `remoteView`, create a new one with `partition: "persist:server-<id>"`, `backgroundThrottling: false` (a reply must finish and notify while the window sits in the tray), load the server origin, attach it, persist `lastServerId`.
- "Servers…" (app menu `CmdOrCtrl+Shift+L`, tray menu): destroy `remoteView`, attach `shellView` and load it with `?list` so it does not auto-connect.
- Remote main-frame `did-fail-load` (not `ERR_ABORTED`): destroy `remoteView` and load `shellView` with `?failed=<id>`, which shows the error screen (Retry / Back) without auto-retrying, so a server whose health check passes but whose page fails cannot loop.
- Attaching a view focuses its webContents, and window `focus` re-focuses the attached view: with `backgroundThrottling: false` the page's `visibilityState` stays `visible` when hidden/minimized, so `document.hasFocus()` is the only signal the web notify hook has.
- Web preferences everywhere: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` (Electron defaults, stated explicitly).

### shell-ui flow (all connection logic lives here; Android reuses it)

1. On load without `?list`: if `lastServerId` exists → run Connect for it; otherwise show the list.
2. Connect: `host.checkServer(url)` →
   - `unreachable` / `not-pika` → error screen (Retry, Back to list).
   - `ok` with `version` major.minor ≠ app major.minor (or `version` null on an older server) → warning screen (Connect anyway, Back).
   - else `host.connect(id)`.
3. Add/Edit: name (optional, defaults to host) + URL; URL is normalized to an origin (`https://` assumed when the scheme is missing, path/query/hash dropped, trailing slash removed). Save runs `checkServer` first and shows the error inline but still allows saving an unreachable server.
4. Settings: hotkey recorder (press a combination → Electron accelerator string; Clear disables), app version, "Check for updates".

Strings: en / zh-CN chosen from `navigator.language`; colors follow `prefers-color-scheme` with tokens copied from the web app's default theme.

## Contracts

### `window.pikaShell` (shell-ui ↔ host; defined in `native/shell-ui/src/host.ts`, implemented by `preload-shell.ts`)

```ts
type Server = { id: string; name: string; url: string };            // url is a normalized origin
type ServerCheck =
  | { ok: true; version: string | null }
  | { ok: false; reason: "unreachable" | "not-pika" };

interface PikaShell {
  appVersion: string;
  listServers(): Promise<{ servers: Server[]; lastServerId: string | null }>;
  saveServer(input: { id?: string; name: string; url: string }): Promise<Server>;
  removeServer(id: string): Promise<void>;
  checkServer(url: string): Promise<ServerCheck>;   // runs in main via net.fetch: no CORS, 5 s timeout
  connect(id: string): Promise<void>;
  getHotkey(): Promise<string | null>;
  setHotkey(accelerator: string | null): Promise<{ ok: boolean }>;  // ok=false when the OS refuses the registration
  checkForUpdates(): Promise<void>;
}
```

`checkServer` → `GET {url}/api/health`: network error/timeout → `unreachable`; non-2xx, non-JSON, or `ok !== true` → `not-pika`; otherwise `version` = string field or null.

Main validates every IPC payload once at the handler (types, URL parse) and only answers IPC from `shellView`.

### `window.pikaNative` (remote page ↔ host; `preload-remote.ts`)

```ts
interface PikaNative {
  serverName: string;                                   // display name of the server this page belongs to
  notify(input: { title: string; body: string; path: string }): void;
  showServerMenu(anchor: { x: number; y: number }): void; // viewport CSS px of the trigger's bottom-left
  openServers(screen: "list" | "add"): void;
}
```

`serverName` reaches the sandboxed preload via `webPreferences.additionalArguments` (`--pika-server-name=<encoded>`).
`showServerMenu` → main pops a native menu at the anchor: saved servers as radio items (current checked), separator,
"Add server…", "Manage servers…". Choosing a server loads shell-ui with `?connect=<id>` (normal health/version flow);
the other two load `?add` / `?list`. All three IPC messages pass the same sender-origin check as `native:notify`.

Web (`src/`), desktop shell only (`window.pikaNative` present), read through one client hook:
- Sidebar root header (`AssistantTree`): brand row becomes a button `[PikaMark] <serverName> ⌄` → `showServerMenu`; in the collapsed icon rail only the mark shows (tooltip = server name).
- `SidebarUserMenu`: label row "<serverName> · <location.host>", item "Switch server…" with the platform shortcut (`⌘⇧L` / `Ctrl+Shift+L`) → `openServers("list")`.
- `(auth)/layout.tsx`: server chip right of the brand row → `showServerMenu`.
- Hydration: the server renders the browser markup; the desktop variant appears after mount without layout shift (same row height/structure).

Main accepts `native:notify` only when `event.senderFrame.origin` equals the active server origin and `path` starts with `/`; shows an Electron `Notification`; on click: show + focus window, `remoteView.webContents.loadURL(origin + path)`.

Web side (`src/`):
- `src/global.d.ts`: `interface Window { pikaNative?: PikaNative }` — the only declaration of the type in the web app.
- Chat pool finish hook gains `isError` and skips aborts/disconnects; `ChatPoolBridge` calls `window.pikaNative?.notify(...)` when `document.visibilityState === "hidden" || !document.hasFocus()`. Title = topic title from the query cache (fallback app name); body = localized "Reply finished" / "Reply failed" (new catalog keys, en + zh-CN); path = `assistantTopicHref(assistantId, topicId)`.

### `/api/health`

`{ ok: true, version: string }`, version imported from root `package.json`. Existing callers only read `ok`.

## Navigation & permissions (remote sessions)

- `setWindowOpenHandler` always returns `deny` (DR7):
  - same origin and path `/api/files/<id>` → remember the URL as "open after download", then `session.downloadURL(url)` on the server's session;
  - other same-origin URLs → ignored;
  - other origins → `shell.openExternal`.
- `session.on("will-download")`: a remembered URL → `setSavePath(<temp dir>/pika-chat/<item.getFilename()>)`, on `done` → `shell.openPath(path)` (OS default app) when the extension is on the document/media allowlist (`OPENABLE_EXTENSIONS` in `main.ts`); anything else (scripts and code the server also accepts, e.g. `.bat`, `.js`, `.ps1`, `.py`, `.sh`) → `shell.showItemInFolder(path)` so a click never executes a file. Other downloads (the image `download` anchor) keep Electron's default save dialog. The temp dir is emptied on app start.
- `will-navigate` to another origin → `preventDefault` + `shell.openExternal`. Redirects (e.g. `S3_DIRECT_ACCESS` 302s) are not navigations and pass through.
- Permission handlers allow only `clipboard-sanitized-write`; everything else denied.
- `shellView` may not navigate away from its file URL; new windows denied.

## Desktop affordances

- Window state (`bounds`, `isMaximized`) saved to the store on `close`; restored only if the bounds intersect a current display.
- Tray: Show/Hide, server list (radio items → connect), Servers…, Check for updates, Quit. Window `close` → hide (all platforms; macOS also keeps the Dock icon; `activate` re-shows). Quit only via tray/menu/`Cmd+Q` (`before-quit` sets a flag so `close` does not hide).
- `requestSingleInstanceLock`; `second-instance` → show + focus. This is also the recovery path on Linux desktops without a tray.
- Global hotkey via `globalShortcut`; toggles show/hide. Registration failure surfaces in settings.
- App menu: macOS standard roles (app, edit, window) so Cmd+C/V/X/A work; View items (Reload, Zoom in/out/reset, Toggle DevTools) are custom items acting on the attached view, because role items target the window's own webContents, not a `WebContentsView`. Win/Linux: `autoHideMenuBar` (Alt reveals; accelerators still work).
- Main-process strings (menu, tray, dialogs) en / zh-CN via `app.getLocale()`.

## Persistence (`store.ts`)

`userData/config.json`: `{ servers: Server[], lastServerId, hotkey, windowState }`, read at startup, written atomically (write temp + rename). Removing a server also calls `session.fromPartition(...).clearStorageData()`.

## Updates (`updater.ts`)

- Windows NSIS, Linux AppImage / deb / rpm: `electron-updater` (6.8.x) with GitHub provider; electron-builder writes `resources/package-type` so the updater picks AppImage/Deb/Rpm automatically. Check on launch and from the menu; `update-downloaded` → dialog "Restart and install / Later" → `quitAndInstall()`. deb/rpm elevate through pkexec at that moment (password prompt); they are not installed silently on quit. An updater `error` during install → dialog with the release download link.
- macOS: `net.fetch` GitHub `releases/latest` for `jason-zzx/pika-chat`; if `tag_name` > app version → dialog with "Download" → `shell.openExternal(html_url)`.
- Manual "Check for updates" reports "up to date" too; the launch check is silent unless an update exists.

## Release & CI

- `release.yml`: new job `build-desktop` (needs `quality-gate`), matrix `ubuntu-latest` (AppImage, deb, rpm x64; installs `rpm` via apt for rpmbuild), `windows-latest` (nsis x64), `macos-latest` (dmg x64 + arm64, `mac.identity: "-"` (ad-hoc; `null` would skip signing entirely and arm64 would not launch) with `hardenedRuntime: false`). Runs `pnpm -C native install --frozen-lockfile` and `electron-builder --publish never`, uploads `release/*.{exe,dmg,AppImage,deb,rpm,blockmap,yml}` as artifacts. `create-release` needs `[build-and-push, build-desktop]`, downloads them, and passes them to `gh release create`. Tags containing `-` (e.g. `v0.5.0-rc.1`) are created with `--prerelease`.
- `ci.yml`: new job `native` — install native workspace, typecheck shell-ui + desktop, run native unit tests, build shell-ui and desktop bundles (no packaging).

## Testing

- Unit (vitest inside `native/`): URL normalization, major.minor compare, health-response classification, accelerator recording mapping. Pure functions only, no Electron mocks.
- Web (`src/`): health route returns version; ChatPoolBridge notify conditions (hidden/unfocused, abort/disconnect skipped, error body) with a real `window.pikaNative` stub object.
- Manual per-OS checklist in `implement.md` (packaging behaviour cannot be unit-tested).

## Risks

- Wayland: `globalShortcut` may not register on some compositors → settings shows the failure; tray/second-launch still work.
- deb/rpm updates need a graphical polkit agent for pkexec; without one the install fails and the dialog falls back to the download link.
- GNOME without AppIndicator extension shows no tray → second launch and hotkey re-show the window.
- macOS unsigned builds: users must clear quarantine (README); arm64 runs via ad-hoc signature.
- Self-signed TLS servers fail with `unreachable`; out of scope.

## Rollback

Delete `native/`, the `build-desktop` job and `create-release` changes, the health `version` field, and the notify hook; web behaviour is unchanged without a shell (`window.pikaNative` undefined).
