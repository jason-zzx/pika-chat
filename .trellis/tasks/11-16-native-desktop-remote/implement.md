# Implement — Desktop shell remote mode

Branch: `feat/native-desktop-remote` from `feat/native-pwa` (carries the planning commits).

## Checklist (in order)

1. **Web contract** (`src/`)
   - [ ] `/api/health` returns `version` from root `package.json`; update `health.service.ts` and its test (if none, add one route-level test).
   - [ ] `src/global.d.ts`: `Window.pikaNative?`.
   - [ ] Chat pool finish hook passes `isError` and skips aborts/disconnects; `ChatPoolBridge` notifies via `window.pikaNative` when hidden/unfocused. New i18n keys (en + zh-CN) for "Reply finished" / "Reply failed".
   - [ ] Tests for the notify conditions; root `pnpm lint && pnpm typecheck && pnpm test`.
   - Gate: web works unchanged in a browser (`pikaNative` undefined).
2. **Repo plumbing**
   - [ ] `native/pnpm-workspace.yaml`, root `tsconfig.json` exclude, `.dockerignore`, `.gitignore`.
3. **shell-ui** (`native/shell-ui`)
   - [ ] `host.ts` contract, `servers.ts` (normalize URL, compare versions, classify health), `i18n.ts`, `main.ts` screens (list, add/edit, connecting/error/warning, settings), `style.css` tokens.
   - [ ] Vitest for `servers.ts` and accelerator mapping.
   - (Dev harness dropped in simplification: iterate with `pnpm -C native/desktop start`.)
4. **desktop** (`native/desktop`)
   - [ ] `store.ts`, `preload-shell.ts`, `preload-remote.ts`, `main.ts` (window, views, IPC, navigation/permissions, menu, tray, single instance, hotkey, notifications), `updater.ts`, `i18n.ts`.
   - [ ] Icons: app icon (1024 png from `src/app/icon.svg`), tray png (Win/Linux), macOS template png @1x/@2x.
   - [ ] `scripts/build.mjs` (esbuild + version define + copy shell-ui dist), `electron-builder.config.mjs` (targets, `extraMetadata.version`, GitHub publish config for updater metadata).
   - [ ] `pnpm -C native/desktop start` runs against a dev server; local `electron-builder --linux AppImage deb rpm` produces working packages (this machine is Fedora: rpm installs natively).
5. **CI / release**
   - [ ] `ci.yml` `native` job.
   - [ ] `release.yml` `build-desktop` matrix + `create-release` attach + `--prerelease` for `-` tags.
6. **Docs**
   - [ ] README.md + README.zh-CN.md: desktop download, macOS quarantine removal (`xattr -dr com.apple.quarantine "/Applications/Pika Chat.app"`), Linux tray note.
   - [ ] Spec: new `.trellis/spec/frontend/` or `guides/` entry for the native bridge contract (`pikaNative`, health `version`).

## Validation commands

```bash
pnpm lint && pnpm typecheck && pnpm test                     # root, unchanged scope
pnpm -C native install --frozen-lockfile
pnpm -C native -r typecheck && pnpm -C native -r test
pnpm -C native/desktop build && pnpm -C native/desktop start  # manual run against :3000
pnpm -C native/desktop dist --linux AppImage deb rpm          # local package smoke (rpm needs rpmbuild)
```

## Manual checklist (Linux locally; Windows/macOS from rc release artifacts)

- [ ] Add two servers (local dev + demo), sign in to each, switch both ways, restart: both still signed in.
- [ ] Minimize / hide to tray / focus another app during a reply → notification; click opens the topic.
- [ ] Abort a reply → no notification.
- [ ] Tray menu items, close-to-tray, second launch focuses, hotkey toggle, hotkey rebind + clear, window restore after restart (incl. maximized).
- [ ] External link dialog + search result links open the system browser; image download shows a save dialog; PDF attachment card, Settings → Files open, and image open-in-new-tab open in the OS default app; no in-app window ever appears.
- [ ] Copy buttons work; Cmd/Ctrl+C/V in composer; zoom and reload menu items act on the server page.
- [ ] Unreachable URL, non-Pika URL, version-mismatch server each show the right screen.
- [ ] Install the deb (Debian/Ubuntu) and rpm (Fedora) packages; update from an older rc via "Restart and install" with the pkexec prompt.
- [ ] rc tag: release has Docker image + all desktop artifacts + `latest.yml` / `latest-linux.yml` (listing AppImage, deb, rpm); marked prerelease.

## Rollback points

- After step 1: web-only commit, safe to ship alone.
- Steps 2–4 are additive under `native/`.
- Step 5 touches `release.yml`: keep it a separate commit so it can be reverted without losing the app.
