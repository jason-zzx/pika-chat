# Native Shell

> Contracts between the web app and the native shells under `native/`
> (Electron desktop today; Android planned). Task context:
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
`preload-shell.ts`. Main validates every IPC payload at the handler and answers
only the shell view. Connection logic (health check, version warning, URL
normalization) lives in shell-ui so Android can reuse it. Query modes of
`index.html`: none (auto-connect to the last server), `?list`, `?add` (add form;
Cancel returns to the list), `?connect=<id>` (connect flow for that server
regardless of the last one), `?failed=<id>` (load-error screen). An unknown id falls back to the list;
only an empty query auto-connects.

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
