# Design — Desktop polish and packaging improvements

## Architecture Overview

```
BrowserWindow (Win/Linux: frame: false; macOS: hiddenInset)
 ├── titlebarView    WebContentsView  file://…/shell-ui/index.html?chrome=titlebar  (0, 0, W, 34)
 ├── activeView      WebContentsView  shellView (?list/?add/…) OR remoteView        (0, 34, W, H-34)
 └── serverMenuView  WebContentsView  file://…/shell-ui/index.html?chrome=menu      (0, 34, W, H-34, #00000000, attached only when open)
```

- Fullscreen collapses `TITLEBAR_HEIGHT` to `0` (`titlebarView` hidden) and expands `activeView` to `(0, 0, W, H)`.
- `serverMenuView` uses `setBackgroundColor("#00000000")` and sits atop `activeView` using window-relative bounds, ensuring identical behavior across Windows, macOS, Linux X11, and Linux Wayland without leaking saved servers to the remote origin.

## Cross-Layer Contracts

### 1. Theme Sync (`preload-remote.ts` / `shell-ui` -> `main.ts` -> `titlebarView` & `serverMenuView`)

```ts
type DesktopThemeColors = {
  isDark: boolean;
  background: string;        // hex #rrggbb
  foreground: string;
  mutedForeground: string;
  popover: string;
  popoverForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
};
```

- `preload-remote.ts` normalizes CSS color values (`oklch`, `lab`, `rgb`, etc.) to `#rrggbb` via a `1x1` `<canvas>` helper, reading computed styles (`--background` / `body.backgroundColor`, `--foreground`, `--muted-foreground`, `--popover`, `--popover-foreground`, `--accent`, `--accent-foreground`, `--border`) on `DOMContentLoaded`, `load`, `MutationObserver` on `<html>` (`class`, `data-theme`, `style`) and `meta[name="theme-color"]`, and `prefers-color-scheme` changes.
- Sent via `ipcRenderer.send("native:theme", colors)` (main validates with Zod + `fromRemote(event)`).
- `shell-ui` sends matching theme colors via `preload-shell.ts` (`shell:setTheme`) so `shell-ui` pages also synchronize the titlebar.
- `main.ts` calls `win.setBackgroundColor(colors.background)` and broadcasts the palette + window maximized state (`titlebar:state`) to `titlebarView` and `serverMenuView`.

### 2. `window.pikaNative` Extension (`src/global.d.ts` & `native/desktop/src/preload-remote.ts`)

```ts
export type DesktopCloseAction = "tray" | "quit";
export type DesktopStorageCategory = "webCache" | "updaterCache" | "logsAndTemp";

export interface DesktopStorageUsage {
  localDataBytes: number;
  webCacheBytes: number;
  updaterCacheBytes: number;
  logsAndTempBytes: number;
}

export interface PikaNativeDesktop {
  platform: "win32" | "linux" | "darwin";
  getSettings(): Promise<{
    closeAction: DesktopCloseAction;
    hotkey: string | null;
    developerMode: boolean;
  }>;
  setCloseAction(action: DesktopCloseAction): Promise<void>;
  setHotkey(accelerator: string | null): Promise<{ ok: boolean }>;
  getStorageUsage(): Promise<DesktopStorageUsage>;
  clearStorage(category: DesktopStorageCategory): Promise<DesktopStorageUsage>;
  openLocalDataFolder(): Promise<void>;
  checkForUpdates(): Promise<void>;
  openDevTools(): Promise<void>;
  openDesktopLog(): Promise<void>;
  setDeveloperMode(enabled: boolean): Promise<void>;
}
```

- `desktop` is **optional** on `PikaNative`, so browsers, Android, and older desktop shells keep working unchanged.
- Every `native:desktop:*` IPC handler in `main.ts` validates `fromRemote(event)` and Zod-parses inputs.
- Web UI:
  - `src/app/(app)/settings/general/page.tsx` renders `<DesktopSettingsSection />` (client leaf reading `usePikaNative()`). Returns `null` if `!native?.desktop`. Contains two `SettingsSection` blocks:
    - **Desktop** (`关闭主窗口时` on Win/Linux + `全局快捷键` recorder/clear).
    - **Storage** (`本地模式数据` size + Open folder; `网页与媒体缓存` size + Clear cache; `更新安装包缓存` size + Clear cache; `日志与临时文件` size + Clear; plus Refresh).
  - `src/components/settings/about/AboutVersionCard.tsx` adds 5-click trigger on the client/local version row when `native?.desktop` exists, activating `developerMode` without auto-opening DevTools, and showing `Check for updates` plus (when `developerMode` is active) `Open DevTools`, `Open desktop log`, and `Disable developer mode` actions.

### 3. `window.pikaShell` Changes (`native/shell-ui/src/host.ts` & `preload-shell.ts`)

- Desktop-only shell chrome & menu methods added under `host.desktop`:
  - `windowControls`: `minimize()`, `toggleMaximize()`, `close()`, `onState(cb)` (maximized + title + theme).
  - `serverMenu`: `getData()` (servers, activeId, localName, theme), `select(id)`, `open(screen: "add" | "list")`, `close()`, `onData(cb)`.
  - `openDevTools()`, `openDesktopLog()`, `setDeveloperMode(enabled)` (for subtle version fallback on desktop `shell-ui`).
- `shell-ui` routing:
  - `?chrome=titlebar`: renders the 34px frameless drag bar + brand/title + Win/Linux window buttons (hidden on macOS where native traffic lights appear).
  - `?chrome=menu`: renders the transparent-backdrop floating menu card at clamped `{ x, y }` with right-side checkmarks and compact left alignment.
  - Desktop `Servers` screen (`host.desktop` defined): removes the `Settings` button from the toolbar; renders a subtle muted version label in the footer supporting the same 5-click `developerMode` activation (without auto-opening DevTools) to reveal inline `Open DevTools` / `Open desktop log` actions.
  - Mobile `Servers` screen (`!host.desktop`): keeps `Settings` button (`Version` + `Check for updates`) unchanged.

### 4. Config, Storage & Lifecycle (`native/desktop/src/store.ts`, `storage.ts`, `main.ts`, `updater.ts`)

- `store.ts`: adds `closeAction: z.enum(["tray", "quit"]).catch("tray")` and `developerMode: z.boolean().catch(false)`.
- `storage.ts` (isolated helper in `native/desktop/src/`):
  - `localDataBytes`: recursive byte size of `<userData>/local` excluding `server.log`.
  - `webCacheBytes`: recursive byte size of Chromium cache subdirs (`Cache`, `Code Cache`, `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `ShaderCache`) directly in `<userData>` and inside `<userData>/Partitions/*`. Clearing runs `ses.clearCache()` on `defaultSession`, `persist:local`, and `persist:server-<id>` partitions (plus removing cache directories safely while leaving `Cookies`, `Local Storage`, `IndexedDB`, and `config.json` intact).
  - `updaterCacheBytes`: recursive byte size of `<appCacheDir>/pika-chat-desktop-updater` (where `appCacheDir` mirrors `electron-updater`'s `AppAdapter.getAppCacheDir()`: `%LOCALAPPDATA%` on win32, `~/Library/Caches` on darwin, `$XDG_CACHE_HOME || ~/.cache` on linux). Clearing removes contents of that dir.
  - `logsAndTempBytes`: `desktop.log` (+ rotated `.1`), `local/server.log`, and `downloadsDir` (`<tmpdir>/pika-chat`). Clearing truncates log files (safe even while open) and cleans rotated/temp files.
- `main.ts` close handling:
  - If `quitting` -> allow close.
  - If `isMac || config.closeAction === "tray"` -> `event.preventDefault(); win.hide();`
  - Else (`closeAction === "quit"` on Win/Linux) -> `event.preventDefault(); app.quit();` so `before-quit` cleanly shuts down `localServer` before destroying the window.
- `main.ts` white-screen mitigation:
  - `layout()` early-returns if `win.isMinimized()` or `width <= 0 || height <= 0`.
  - `showWindow()`, `win.on("show")`, `win.on("restore")`, `win.on("maximize")`, `win.on("unmaximize")` run `layout()` and `activeView().webContents.invalidate()`.
  - `render-process-gone` logs to `<userData>/desktop.log` and reloads once (if two crashes happen within 10s on a remote view, switches to `shellView` `?failed=<id>`).
  - `app.on("child-process-gone")` logs GPU/utility crashes and calls `invalidate()` on visible views.
  - `devTools` in View menu and Tray menu (`openDevTools({ mode: "detach" })` + `openDesktopLog`) are only added when `config.developerMode === true`.
- `updater.ts`:
  - Uses `electron-updater` only when `app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"))` (NSIS, AppImage, deb, rpm).
  - Otherwise (macOS `.dmg`, Windows portable `.zip`) uses `checkReleasePrompt(manual)` querying GitHub `releases/latest`.

### 5. Packaging & NSIS Uninstaller (`electron-builder.config.mjs`, `assets/`, `.github/workflows/release.yml`)

- `native/desktop/assets/icons/{16x16,32x32,48x48,64x64,128x128,256x256,512x512}.png` generated from `assets/icon.png`; `linux.icon` set to `"icons"`.
- `native/desktop/assets/installerSidebar.bmp` (`164x314`) and `installerHeader.bmp` (`150x57`) generated as 24-bit BMPs.
- `win.target`: `nsis` (`oneClick: false`, `perMachine: false`, `allowElevation: true`, `allowToChangeInstallationDirectory: true`, sidebar/header BMPs, `include: "installer.nsh"`) + `zip` (`x64`).
- `native/desktop/assets/installer.nsh`:
  - Uses `!macro customUnWelcomePage` (in `BUILD_UNINSTALLER`, which `assistedInstaller.nsh` inserts before `MUI_UNPAGE_INSTFILES`) to render an `nsDialogs` uninstall confirmation page with an **unchecked** checkbox (`$unDeleteUserData`) asking whether to also delete `%AppData%\Pika Chat` (`${PRODUCT_FILENAME}` / `${APP_FILENAME}` / `${APP_PACKAGE_NAME}`), skipped automatically during `/S` or `--updated`.
  - Uses `!macro customUnInstall` guarded by `${ifNot} ${isUpdated}` to:
    1) Always remove `$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater` (checking current user `$LOCALAPPDATA` via `SetShellVarContext current` if `all`).
    2) If `$unDeleteUserData == ${BST_CHECKED}`, remove `$APPDATA\${PRODUCT_FILENAME}` (and `$APPDATA\${APP_PACKAGE_NAME}` if distinct).
- `.github/workflows/release.yml`: add `native/desktop/release/*.zip` to `upload-artifact`.

## Trade-offs & Compatibility

- **NSIS Scheme 1**: Preserves `.blockmap` differential updates and standard Windows Defender reputation; `Nsis7z::Extract` inside `app-builder-lib` may still show an internal progress reset during the extraction step on `MUI_PAGE_INSTFILES`.
- **Portable `.zip` `userData`**: Keeps `%AppData%\Pika Chat` so updating via new `.zip` inherits all state; moving the extracted folder to a different PC does not copy `%AppData%`.
- **Web vs older shell compatibility**: All new `window.pikaNative.desktop` fields are optional; older shells and browsers ignore them gracefully, and `preload-remote.ts` theme observation works even against older servers.
