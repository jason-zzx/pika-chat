# Desktop shell remote mode

Parent: `11-16-native-apps` (D3, D4, D5, D7; R1–R5; contracts in parent `design.md`).

## Goal

An Electron desktop app for Windows, macOS, and Linux that connects to one or more deployed Pika servers and adds the desktop affordances a browser tab lacks: tray, global hotkey, system notifications, auto-update.

## Repo Facts

- Root `pnpm-workspace.yaml` has no `packages` (single-package workspace; holds `allowBuilds` / `minimumReleaseAgeExclude`). Dockerfile copies `package.json pnpm-lock.yaml pnpm-workspace.yaml` then `pnpm install --frozen-lockfile`, then `COPY . .`; `.dockerignore` does not exclude `native/`.
- Root `tsconfig.json` includes `**/*.ts(x)`; `pnpm lint` is `eslint src`; vitest includes only `src/**`.
- Root TypeScript 5.9.3, pnpm 11.9.0, Node 22 in CI. Latest at planning time: electron 45.3.4, electron-builder 26.18.0, electron-updater 6.8.11, vite 8.3.8.
- `release.yml` on `v*.*.*`: quality-gate → multi-arch Docker push → `create-release` (`gh release create` with notes from `scripts/extract-changelog.mjs`). There is no separate native workflow.
- `/api/health` returns `{ ok: true }` (`src/server/services/health.service.ts`); no CORS headers, so a `file://` shell page cannot fetch it from the renderer.
- Stream completion: `chat-pool.ts` `onFinish` → `bridge.invalidateAfterFinish(topicId)`, registered by `src/components/providers/ChatPoolBridge.tsx:118` (client component with query client access). Topic URLs come from `assistantTopicHref(assistantId, topicId)` (`src/lib/assistant-path.ts`).
- Same-origin new-tab links (`target="_blank"`) to `/api/files/<id>`: non-image attachment cards (`MessageItem.tsx:184-187`), Settings → Files open button (`FilesList.tsx:130-133`), image preview open-in-new-tab (`ImagePreviewDialog.tsx:261-264`). The file route sets `Content-Disposition` (`src/app/api/files/[id]/route.ts:66`).
- External links: `ExternalLinkDialog.tsx:74` → `window.open(url, "_blank", "noreferrer")`; search results use `<a target="_blank">` (`SearchToolCall.tsx:177`). Image download/open-in-new-tab are same-origin anchors to `/api/files/...` (`ImagePreviewDialog.tsx:246-260`); with `S3_DIRECT_ACCESS` they 302 to the bucket origin.
- Browser permissions used by the web app: clipboard write (copy buttons, `src/lib/clipboard.ts`, polyfill in `AppProviders`). No `getUserMedia`, no fullscreen API.
- Auth is email/password + TOTP only (no OAuth redirects to third-party origins).

## Decisions (user)

- One active server at a time (switching unloads the previous page; sessions persist).
- Reply notifications only inside the desktop shell; no browser/PWA notifications in this task.
- Global hotkey configurable in shell settings, default Ctrl/Cmd+Shift+Space, can be disabled.
- The app must feel like a desktop app, not a browser wrapper: it never opens in-app browser windows.
- Linux ships AppImage, deb, and rpm.
- Switching servers is reachable inside the page (added after first implementation review): the sidebar's top brand row becomes a server switcher (`[mark] <server name> ⌄`) opening a native menu (saved servers with the current one checked, Add server…, Manage servers…); the account menu shows the current server and "Switch server…" (Ctrl/Cmd+Shift+L); auth pages show the same server chip top-right. Desktop shell only; browser/PWA unchanged. The page never receives the list of other servers.

## Requirements

- R-D1 `native/shell-ui`: server list (add / edit / remove / connect), connection errors with retry, version-mismatch warning, shell settings; en + zh-CN following the OS locale; light/dark following the OS.
- R-D2 Each server entry gets its own persistent Electron session (`persist:server-<id>`); signing in to one server never affects another.
- R-D3 The app never opens a second in-app window. Same-origin file links (`/api/files/<id>`, opened via `target="_blank"`) are downloaded with the server session to a temp dir and opened in the OS default app (PDF viewer, image viewer, Office…) — script/code files are only revealed in the file manager, never executed; any other same-origin new window is ignored; other origins open in the system browser.
- R-D12 Server switching UI per the decision above; selecting another server from the native menu goes through the shell's normal connect flow (health check, version warning).
- R-D4 Window position/size/maximized state restored on launch.
- R-D5 Tray icon with menu (show, switch server, check for updates, quit); closing the window hides to tray; a second app launch focuses the existing window.
- R-D6 Global hotkey shows/hides the window.
- R-D7 `/api/health` returns `version`; the shell warns (non-blocking) when server and app major.minor differ.
- R-D8 When a reply finishes while the window is hidden, minimized, or unfocused, the shell shows a system notification; clicking it focuses the window and opens that topic.
- R-D9 Updates: Windows (NSIS), Linux AppImage, deb, and rpm update through electron-updater (deb/rpm install via the system package manager and ask for the admin password through pkexec when the user chooses "Restart and install"; if that fails, show the release download link). macOS shows a "new version available" prompt linking to the release.
- R-D10 Release builds Windows x64 NSIS, macOS dmg (x64 + arm64, unsigned/ad-hoc), Linux AppImage + deb + rpm x64 and attaches them to the tag's GitHub Release. README (en + zh-CN) documents install and macOS quarantine removal.
- R-D11 `native/` excluded from root tsconfig and Docker build context; root lint/typecheck/test and Docker image unchanged.

## Out of Scope

- Local mode (`11-16-native-desktop-local`), Android (`11-16-native-mobile`).
- Code signing / notarization; Windows arm64, Linux arm64.
- Self-signed TLS certificate trust UI; proxy configuration.
- Deep links, share target.

## Acceptance Criteria

- [ ] Add two servers, sign in to each, switch between them; sessions stay independent across app restarts.
- [ ] From inside a connected server (chat page, settings page, sign-in page) the user can switch to another saved server, add a new server, or open server management without using the tray or the hidden menu bar.
- [ ] A reply finishing while the window is hidden/minimized/unfocused shows a system notification; clicking it focuses the window on that topic.
- [ ] Tray menu, close-to-tray, second-launch focus, global hotkey, and window-state restore work on Windows, macOS, and Linux.
- [ ] External links (link dialog, search results) open in the system browser; image download shows a save dialog; attachment cards, Settings → Files open, and image open-in-new-tab open the file in the OS default app; no in-app browser window ever appears.
- [ ] A server whose major.minor differs shows a warning; an unreachable or non-Pika URL shows a retryable error.
- [ ] A `v*` tag (or rc tag) produces all desktop artifacts on one GitHub Release alongside the Docker image; an older Windows / AppImage / deb / rpm build updates (deb/rpm after the password prompt).
- [ ] Root `pnpm lint && pnpm typecheck && pnpm test` pass; Docker build unaffected.

## Outcome Notes

- Archived with manual verification skipped at the user's request. Automated: root lint/typecheck/tests, native typecheck/tests, desktop build, local AppImage build + boot, DevTools checks of the shell bridge and auth-page server chip.
- Not yet verified (carry to an rc release): signed-in sidebar switcher / account menu / native popup, notifications, tray + hotkey + close-to-tray, Windows/macOS packages, deb/rpm install and pkexec update, the release workflow itself.
- Known follow-ups: http→https redirecting servers break origin matching; tray "Switch server" submenu bypasses the health/version check; startup hotkey registration failure only logged.
