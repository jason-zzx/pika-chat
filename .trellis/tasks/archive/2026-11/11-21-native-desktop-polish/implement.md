# Implement — Desktop polish and packaging improvements

## Ordered Checklist

1. **Generate packaging assets**
   - Generate `native/desktop/assets/icons/{16x16,32x32,48x48,64x64,128x128,256x256,512x512}.png` from `native/desktop/assets/icon.png`.
   - Generate 24-bit BMPs `native/desktop/assets/installerSidebar.bmp` (`164x314`) and `native/desktop/assets/installerHeader.bmp` (`150x57`).
   - Author `native/desktop/assets/installer.nsh` (`customUnWelcomePage` checkbox + `customUnInstall` updater-cache & optional user-data cleanup).
2. **Packaging & Release CI**
   - Update `native/desktop/electron-builder.config.mjs` (`win` `nsis` + `zip`, `nsis` wizard + `include: "installer.nsh"`, `linux.icon: "icons"`).
   - Update `.github/workflows/release.yml` to upload `native/desktop/release/*.zip`.
   - Update `native/desktop/src/updater.ts` to fall back to release prompt when `app-update.yml` is missing.
3. **Desktop store, storage, logging, white-screen fixes, titlebar & server menu (`native/desktop`)**
   - Extend `native/desktop/src/store.ts` (`closeAction`, `developerMode`).
   - Add `native/desktop/src/storage.ts` (recursive byte calculation + non-overlapping categories + safe cache/log cleanup).
   - Add `desktop.log` logger, `frame: false` / macOS `hiddenInset`, `titlebarView`, `serverMenuView`, minimize/restore `layout()` + `invalidate()`, `render-process-gone` / `child-process-gone` handling, `developerMode`-gated DevTools, and `native:desktop:*` + `native:theme` IPC handlers in `native/desktop/src/main.ts` & `native/desktop/src/i18n.ts`.
   - Update `native/desktop/src/preload-shell.ts` and `native/desktop/src/preload-remote.ts` (including CSS token / `theme-color` observer).
4. **Shell UI updates (`native/shell-ui`)**
   - Extend `native/shell-ui/src/host.ts`, `native/shell-ui/src/i18n.ts`, `native/shell-ui/src/style.css`, and `native/shell-ui/src/main.ts` for `?chrome=titlebar`, `?chrome=menu`, desktop server-list cleanup (no Settings button on desktop; subtle 5-click version footer activating `developerMode` without auto-opening DevTools), and desktop theme broadcast.
5. **Web UI desktop settings, storage & diagnostics (`src/`)**
   - Update `src/global.d.ts` (`PikaNativeDesktop`, `DesktopStorageUsage`, etc.).
   - Add `src/lib/desktop-hotkey.ts` (with unit tests) and `src/components/settings/general/DesktopSettingsSection.tsx` (with unit tests covering close action, hotkey, and 4-category storage breakdown/cleanup) and wire into `src/app/(app)/settings/general/page.tsx`.
   - Update `src/components/settings/about/AboutVersionCard.tsx` (and `.test.tsx`) for 5-click version trigger (activating `developerMode` without auto-opening DevTools), update check, and developer diagnostics actions.
   - Update `messages/en.json` and `messages/zh-CN.json`.
6. **Spec sync & verification**
   - Update `.trellis/spec/guides/native-shell.md` to reflect the new `pikaNative.desktop`, `chrome=titlebar` / `chrome=menu` views, `zip` target, NSIS uninstaller cleanup, and `icons` directory.
   - Run full validation:
     - `pnpm lint && pnpm typecheck && pnpm test`
     - `pnpm -C native -r typecheck && pnpm -C native --filter @pika/shell-ui test && pnpm -C native --filter pika-chat-desktop build`
     - Verify `electron-builder` Linux RPM/AppImage/deb packaging locally (`rpm` tooling check; Windows NSIS/zip verified via CI).

## Risky Files / Rollback Points

- `native/desktop/src/main.ts`: window lifecycle, view bounds, and IPC origin guards (`fromRemote`). Keep `shellView` and `remote.view` origin checks strict.
- `native/desktop/src/storage.ts`: strictly target cache subdirs (`Cache`, `Code Cache`, `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `ShaderCache`) when clearing `webCache` so `Cookies`, `Local Storage`, `IndexedDB`, and `local/` SQLite files are never touched.
- `native/desktop/assets/installer.nsh`: guard all cleanup with `${ifNot} ${isUpdated}` so auto-update runs never delete user data or break active update files.
- `native/desktop/electron-builder.config.mjs`: maintain `AppImage, deb, rpm` Linux target order per `.trellis/spec/guides/native-shell.md:245-247`.
- `src/components/settings/about/AboutVersionCard.tsx`: ensure browser / Android / older shell tests stay unchanged when `native?.desktop` is absent.
