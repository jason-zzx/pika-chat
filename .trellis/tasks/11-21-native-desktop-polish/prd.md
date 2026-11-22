# Desktop polish and packaging improvements

Parent: `11-16-native-apps`

## Goal

Fix Windows & Linux (RPM) prerelease packaging issues, move desktop preferences and client storage visibility into `Settings -> General` & `Settings -> About`, replace the native server switcher menu and OS window frame with theme-integrated shell UI, and mitigate Windows taskbar hide/show white screens with diagnostic logging and a hidden DevTools trigger.

## Confirmed Facts

- **Windows packaging** (`native/desktop/electron-builder.config.mjs:19`): `win.target` builds only `nsis` with default `oneClick: true` and `perMachine: false`, silently installing to `%LocalAppData%\Programs\pika-chat` with no directory selection wizard and no portable `.zip`.
- **NSIS progress bar & uninstaller** (`app-builder-lib` `templates/nsis/include/extractAppPackage.nsh:73,97,108`, `assistedInstaller.nsh:66-82`, `uninstaller.nsh:216-248`): in `oneClick`, `File` advances NSIS progress to unpack `app-64.7z`, `Nsis7z::Extract` resets the bar `0% -> 100%`, and post-extraction steps resume NSIS's instruction counter. Switching to `oneClick: false` provides a multi-page wizard with directory/mode selection and custom brand graphics while keeping `.blockmap` differential updates and Defender compatibility. In `assistedInstaller.nsh`, `customUnWelcomePage` runs before `MUI_UNPAGE_INSTFILES`, whereas `customUninstallPage` runs after; default uninstall leaves `%AppData%\Pika Chat` and `%LocalAppData%\pika-chat-desktop-updater` on disk.
- **Close behavior** (`native/desktop/src/main.ts:452-458`): `win.on("close")` unconditionally hides to tray on all platforms.
- **Server selector menu** (`src/components/assistant/AssistantTree.tsx:140-157`, `src/components/auth/DesktopServerChip.tsx:22-25`, `native/desktop/src/main.ts:336-361`): `native.showServerMenu(anchor)` uses Electron `Menu.buildFromTemplate` with `type: "radio"` entries, which reserves a wide left gutter across all items including "Add server..." and "Manage servers..." and renders OS-native styling. `.trellis/spec/guides/native-shell.md:38-40` requires that the remote page never receive the list of other servers.
- **Windows white screen & DevTools** (`native/desktop/src/main.ts:117-133,438`): `win.on("resize", layout)` assigns `0x0` bounds to `activeView()` when minimized on Windows; `show`/`restore` do not re-sync bounds or call `invalidate()`; no `render-process-gone` or `child-process-gone` recovery or main-process log exists; and `devTools` (`CmdOrCtrl+Alt+I`) is always exposed in the View menu.
- **RPM icon** (`native/desktop/electron-builder.config.mjs:41`, `app-builder-lib` `util/iconConverter.js:188-207`, `targets/FpmTarget.js:216-220`): `linux.icon: "icon.png"` resolves to a single `1024x1024` PNG, bypassing icon-set generation and installing only `/usr/share/icons/hicolor/1024x1024/apps/pika-chat-desktop.png`, whereas `/usr/share/icons/hicolor/index.theme` indexes up to `512x512`.
- **Titlebar & theme tokens** (`native/desktop/src/main.ts:88-98`, `src/components/layout/use-theme-sync.ts:24-28`): `BrowserWindow` uses the thick native OS frame. Web pages update `meta[name="theme-color"]` and CSS variables on `<html>` across 7 presets in light/dark modes.
- **Desktop settings & storage** (`src/app/(app)/settings/general/page.tsx`, `src/components/settings/about/AboutVersionCard.tsx`, `native/shell-ui/src/main.ts:134`, `electron-updater` `out/AppAdapter.js`): `shell-ui` mixes desktop settings into the server list screen, whereas the main app owns `Settings -> General` and `Settings -> About`. Desktop clients accumulate data across `<userData>/local` (SQLite + files), Chromium `Cache`/`Code Cache`/`GPUCache` across `<userData>` and `Partitions/*`, updater cache (`<appCacheDir>/pika-chat-desktop-updater`), and logs/temp downloads (`<userData>/desktop.log`, `server.log`, `<tmpdir>/pika-chat`).

## Requirements

### R1. Windows Installer Wizard, Uninstaller Cleanup & Portable Zip
- Configure `nsis` with `oneClick: false`, `perMachine: false`, `allowElevation: true`, `allowToChangeInstallationDirectory: true`, and custom Pika Chat `installerSidebar.bmp` (`164x314`) / `installerHeader.bmp` (`150x57`) graphics.
- Customize NSIS uninstaller via `native/desktop/assets/installer.nsh`:
  - Automatically remove pure updater cache (`%LocalAppData%\pika-chat-desktop-updater`) during real user-initiated uninstalls (`${ifNot} ${isUpdated}`), never during auto-update overwrites.
  - Add an optional checkbox (default **unchecked**) on `customUnWelcomePage` (before `MUI_UNPAGE_INSTFILES`) allowing the user to also wipe `%AppData%\Pika Chat` on real uninstall (`${ifNot} ${isUpdated}`).
- Add `{ target: "zip", arch: ["x64"] }` to `win.target` and upload `*.zip` in `.github/workflows/release.yml`.
- Keep `userData` in `%AppData%\Pika Chat` for both NSIS and portable `.zip` builds so extracted updates inherit servers, sessions, preferences, and local-mode DB/files.
- In `native/desktop/src/updater.ts`, fall back to the GitHub Release download prompt when `resources/app-update.yml` is absent (covering portable `.zip` builds as well as macOS `.dmg`).

### R2. Desktop Settings in `Settings -> General` & Clean Server Management
- Move desktop-specific settings into the web app's `Settings -> General` (`/settings/general`) via optional `window.pikaNative.desktop`, invisible in browsers/mobile/older shells:
  - **Close window action** (Windows & Linux only): `"tray"` (Minimize to system tray, default) vs `"quit"` (Quit application). macOS retains native hide-to-Dock on close.
  - **Global shortcut**: hotkey recorder + Clear action.
- Strip desktop settings out of `native/shell-ui` on desktop so server management contains only server-related functionality (retaining `shell-ui` Settings only when `!host.desktop`, i.e., Android).

### R3. Custom Themed Server Selector Dropdown
- Replace `Menu.buildFromTemplate` in `native:showServerMenu` with a shell-owned transparent `WebContentsView` popover rendered above `remote.view` (`preload-shell.js` + `shell-ui` `?chrome=menu`).
- Render compact left-aligned rows matching Pika Chat's theme & shadcn `SelectItem` visual style (active check indicator on the right, no empty left radio gutter on "Add server..." / "Manage servers..."), clamped inside the viewport from either top-left (`AssistantTree`) or top-right (`DesktopServerChip`) triggers.
- Preserve the `.trellis/spec/guides/native-shell.md` invariant: the remote web page never receives the list of other servers.

### R4. Windows Taskbar White-Screen Fix, Diagnostic Log, & Hidden Console Trigger
- Skip `0x0` bounds updates in `layout()` when `win.isMinimized()` or dimensions are zero; re-sync bounds and call `webContents.invalidate()` on `show`, `restore`, `maximize`, and `unmaximize`.
- Add `render-process-gone` recovery (auto-reload once, falling back to `?failed=<id>` on rapid repeat crashes) and `child-process-gone` GPU recovery (`invalidate()`).
- Write main-process lifecycle/error logs to `<userData>/desktop.log` (capped/rotated on startup).
- Remove the default `CmdOrCtrl+Alt+I` / View DevTools menu exposure when `developerMode` is off.
- Unlock developer diagnostics by clicking the version number 5 consecutive times in `Settings -> About` (`AboutVersionCard.tsx`) — plus a subtle muted version label fallback at the bottom of desktop `shell-ui` — activating `developerMode` only (without auto-opening DevTools) and revealing `Open DevTools` (`openDevTools({ mode: "detach" })`) / `Open desktop log` in `Settings -> About`, `shell-ui` fallback, and the Tray/App menus so the user opens DevTools explicitly on demand.

### R5. RPM Application Icon Fix
- Generate multi-size PNG icons (`16x16`, `32x32`, `48x48`, `64x64`, `128x128`, `256x256`, `512x512`) under `native/desktop/assets/icons/` and configure `linux.icon: "icons"` in `electron-builder.config.mjs` so RPM/deb/AppImage install full `hicolor` icon sizes matching `Icon=pika-chat-desktop`.

### R6. Integrated Theme-Synced Top Titlebar (Scheme A)
- Use `frame: false` on Windows and Linux (`titleBarStyle: "hiddenInset"` + `trafficLightPosition` on macOS) with a shell-rendered `34px` top titlebar `WebContentsView` (`?chrome=titlebar`) positioned above the active content view (hidden in fullscreen).
- Observe active theme colors (`--background`, `--foreground`, `--muted-foreground`, `--popover`, `--popover-foreground`, `--accent`, `--accent-foreground`, `--border`) in `preload-remote.ts` (and `shell-ui`) and sync them via IPC to `main.ts`, `win.setBackgroundColor(...)`, `titlebarView`, and `serverMenuView`.

### R7. Desktop Client Storage Space View & Cache Cleanup (`Settings -> General`)
- Add a PC Desktop-only "Storage" / "存储空间" card inside `Settings -> General` (rendered only when `native?.desktop` is present, for both remote and local modes) displaying exact disk usage across 4 non-overlapping categories plus a Refresh action:
  1. **Local data** (`<userData>/local` excluding `server.log`: SQLite DB + local uploaded files + secrets) — size + "Open folder" button (no one-click delete to avoid accidental chat loss).
  2. **Web & media cache** (Chromium HTTP/Code/GPU/Dawn caches in `<userData>` and `Partitions/*`, preserving cookies, sessions, localStorage, and IndexedDB) — size + "Clear cache" button.
  3. **Updater cache** (`<appCacheDir>/pika-chat-desktop-updater`) — size + "Clear cache" button.
  4. **Logs & temporary files** (`desktop.log`, rotated log, `local/server.log`, `<tmpdir>/pika-chat`) — size + "Clear" button.

## Acceptance Criteria

- [ ] Windows release builds an assisted NSIS installer (directory selection, custom sidebar/header BMPs, pre-uninstall optional data-wipe checkbox, automatic updater-cache cleanup on real uninstall) and a portable `.zip`; portable `.zip` shares `%AppData%` and falls back to release-link update prompts.
- [ ] `Settings -> General` (in desktop shell) exposes close-window behavior (`tray` default / `quit` on Win/Linux), global shortcut, and the 4-category client storage breakdown with safe cache/log cleanup; desktop `shell-ui` server management contains no non-server settings.
- [ ] Server switcher renders a custom themed popover with no left radio gutter on Add/Manage items and no server-list leak to remote pages.
- [ ] Minimizing/hiding and restoring via Windows taskbar preserves non-zero bounds and triggers repaint; renderer/GPU crashes log to `desktop.log` and recover cleanly; multi-clicking version 5 times activates `developerMode` (without auto-opening DevTools) and exposes on-demand DevTools and log triggers with no default DevTools shortcut.
- [ ] RPM builds contain `/usr/share/icons/hicolor/{16..512}x{16..512}/apps/pika-chat-desktop.png` and display the app icon after install.
- [ ] Windows and Linux render the `34px` integrated frameless titlebar dynamically matching all web app themes and `shell-ui` light/dark modes.
- [ ] Root `pnpm lint && pnpm typecheck && pnpm test` and `pnpm -C native ...` typecheck/tests/build pass.

## Out of Scope

- Custom HTML/WebView2 Windows installer replacing NSIS (explicitly deferred in favor of NSIS Scheme 1; `Nsis7z` internal progress-bar phase reset inside `app-builder-lib` remains an upstream NSIS template quirk outside this scope).
- Code signing / EV certificates on Windows or notarization on macOS.
- Android UI or packaging changes (Android keeps `shell-ui` Settings for update checks and relies on Android system storage management).
