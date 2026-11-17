# Desktop shell remote mode

Parent: `11-16-native-apps` (D3, D4, D5, D7; R1–R5; contracts in parent `design.md`).

## Goal

An Electron desktop app for Windows, macOS, and Linux that connects to one or more deployed Pika servers.

## Requirements (to be refined into design.md / implement.md before start)

- Shared `native/shell-ui`: server list (add / edit / remove / connect), connect errors, version-mismatch warning; en + zh-CN following the OS locale.
- Per-server `persist:` session partitions; external-origin navigation opens the system browser.
- Window state memory, tray with close-to-tray, configurable global hotkey to show/hide.
- `/api/health` returns `version`; `window.pikaNative.notify` bridge + web hook in `chat-pool.ts` with Web Notification fallback.
- Updates: electron-updater on Windows/Linux; macOS shows a download prompt. README documents macOS quarantine removal.
- `native.yml` builds Win (nsis), macOS (dmg, x64 + arm64), Linux (AppImage + deb) on `v*` tags and attaches to the release.
- `native/` excluded from root tsconfig, eslint, Docker context.

## Acceptance Criteria (draft)

- [ ] Add two servers, sign in to each, switch between them; sessions stay independent across restarts.
- [ ] A generation finishing while the window is hidden/minimized shows a system notification; clicking it opens that topic.
- [ ] Tray, close-to-tray, hotkey, window state, external links work on all three OSes.
- [ ] Server with different major.minor shows a warning; unreachable server shows a retryable error.
- [ ] Tag build produces all desktop installers on the release; Win/Linux auto-update from an older build.
