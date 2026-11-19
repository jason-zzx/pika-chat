# Desktop local mode

Parent: `11-16-native-apps` (D2, D6; local-mode contract in the parent `design.md`).
Depends on: `11-16-native-desktop-remote` (shell, shell-ui, packaging pipeline); this branch is cut from it.
Design: `design.md`. Plan: `implement.md`. Evidence: `research/pglite-spike.md` (+ `.patch`).

## Goal

The desktop app works with no server. Choosing "This computer" starts a bundled Pika server on this machine, and the user is in chat right away, with no setup or login. Data stays local and is never synced (D2).

## Decisions

| ID | Decision | Source |
|---|---|---|
| L1 | One installer per platform bundles local mode. There is no slim variant and no on-demand download. | user |
| L2 | First launch (no saved servers and nothing to auto-connect to) shows a welcome screen with two choices: "Use on this computer" and "Connect to a server". The welcome only picks the first destination and never locks it in. From then on, switching happens in the server list (plan 1): a pinned "This computer" row comes first in the server list, the native switcher popup and the tray switch submenu, and cannot be edited or removed. Remote servers stay addable from the same list. All existing entry points reach it: sidebar switcher, account menu "Switch server…", tray, and the auth-page server chip. Local and remote data are independent, so switching either way loses nothing. | user |
| L3 | Embedded DB is PGlite, not embedded-postgres. The spike passes the full integration suite with five small fixes and two migration breakpoints. embedded-postgres would add 59–337 MB per platform, is beta-only and has no Windows arm64. | spike |
| L4 | The local server starts on the first connect to "This computer", including auto-connect at launch. It keeps running after switching to a remote server or closing to tray, so background replies finish, and stops on quit. | default |
| L5 | Local mode hides: sign-out, the Account settings page (password, 2FA), the Users page (user management, registration toggle, storage quotas). The local user has unlimited storage. | D6 + default |

## Requirements

- R1 **DB:** PGlite in-process when `PGLITE_DATA_DIR` is set; postgres-js otherwise, unchanged. Fix the PGlite deadlocks and result-shape differences found by the spike at `setup.service.ts:22`, `message.service.ts:720`, `compression.service.ts:242`, `generation.service.ts:119` and `demo-usage.service.ts:33`. Migrations `0000` / `0024` get statement breakpoints.
- R2 **`LOCAL_MODE=1`:**
  - migrates at boot;
  - provisions one local super admin on first boot;
  - the shell signs it in automatically, and signs in again if the session ever lapses;
  - the hidden UI from L5;
  - `/settings/account` and `/settings/users` redirect to `/settings/general`.
- R3 **Network:** the server binds `127.0.0.1` only. The port is chosen once and reused, because localStorage (drafts, search mode, assistant tree, pending requests) is scoped by origin, port included. A new port is picked only when the saved one is taken.
- R4 **Secrets and data:** secrets are generated once and stored with Electron `safeStorage`. A secret that fails to decrypt is shown as an error and never silently regenerated. DB, files and log live under `<userData>/local/` and survive app updates.
- R5 **Lifecycle:**
  - per L4;
  - a graceful shutdown closes the DB;
  - the existing single-instance lock prevents two processes from opening one data dir.
  - Startup failure shows a shell-ui error with an "Open log" action.
- R6 **Packaging:**
  - the Next standalone server, static assets, public files and migrations ship as an electron-builder extra resource;
  - each installer is built on a runner of its own arch, because sharp binaries are arch-specific, so macOS splits into intel and arm64 jobs.
- R7 **CI:** a PGlite integration job runs alongside the Postgres one.
- R8 **Docs:** README (en + zh-CN) desktop local-mode section; `guides/native-shell.md`; new `backend/local-mode.md`; the transaction rule in `database-guidelines.md`.

## Acceptance Criteria

- [ ] Fresh install → welcome screen → "Use on this computer" → chat page with no setup or login. Add a provider, chat, upload a file, generate an image.
- [ ] After choosing "Use on this computer", the sidebar switcher or account menu opens the list, where a remote server can be added and connected. After choosing "Connect to a server", "This computer" is selectable from the list, the switcher popup and the tray. Switching back and forth keeps both sides' data and sessions.
- [ ] Quit and relaunch: it auto-connects to "This computer"; topics, files and composer drafts are still there.
- [ ] The server listens on `127.0.0.1` only (`ss -ltnp`) and is unreachable from another machine on the LAN.
- [ ] Sign-out, Account, Users and the registration toggle are not visible in local mode; `/settings/account` redirects.
- [ ] Switching to a remote server while a local reply is generating, then switching back, shows the finished reply.
- [ ] A forced startup failure (e.g. an unwritable data dir) shows the error view with "Open log".
- [ ] `PGLITE_DATA_DIR=memory:// pnpm vitest run --project integration` passes, and the Postgres suite still passes.
- [ ] Web/Docker without `LOCAL_MODE` / `PGLITE_DATA_DIR` behaves as before; lint, typecheck and tests are green, root and native.
- [ ] A release build attaches installers that include the local server (verified locally for the Linux AppImage; Windows/macOS deferred to an rc tag).

## Out of Scope

- Data sync, export/import, backup, "reset local data", and access to the local instance from LAN or a browser (D2, parent).
- Multiple local profiles; changing the data dir location.
- Downgrading after a newer migration ran.
- Server-side API blocks for the hidden actions (only the local user can reach the API).

## Outcome Notes (2026-11-18)

Work commits: `9e77cb5` (server), `158b53a` (desktop), `72a7389` (release), `87e652e` (docs), `d8219ea` (planning).

Verified locally:
- **Root:** lint and typecheck pass. The Postgres suite passes (1543 tests; integration 281/281). The PGlite integration suite passes twice (278 passed, 3 skipped by design).
- **Native:** typecheck and tests (12/12) pass, and the desktop build succeeds.
- **Standalone build:** it contains the pglite assets. `build-server.mjs` output has no symlinks and no `.env`.
- **Linux AppImage smoke** (throwaway userData, driven over CDP):
  - welcome → "Use on this computer" → chat page with no login;
  - bound to `127.0.0.1` only; `/api/health` ok;
  - the Account/Users pages are gated;
  - the pinned local row comes first in the list;
  - "Connect to a server" → Cancel returns to the list;
  - a relaunch reuses the port and the session, and does not provision the admin again;
  - `app.quit()` takes the graceful parentPort shutdown path (no kill);
  - lapsed-session re-sign-in works for both reload and client-router navigations;
  - user env vars (`S3_*`, `DEMO_MODE`, `NODE_OPTIONS`) do not reach the server.
- After ponytail-review: unpackaged Electron smoke — welcome view, local connect, graceful quit within ~2 s, relaunch auto-connects on the same port.

Deferred to an rc tag:
- Windows and macOS installers, including `utilityProcess` + `safeStorage` behaviour and junction handling in `build-server.mjs` on Windows.
- The split mac runners.
- The CI PGlite step and the release workflow.
- Driving the native switcher popup and tray submenu, which were only checked by reading the code.
- The full provider / chat / upload / image-generation flow in local mode.
- Switching to a remote server during a local reply.
- A forced startup failure view.
- LAN unreachability from a second machine; `ss` shows only 127.0.0.1.

Known follow-ups:
- On Windows, NSIS `quitAndInstall` may race the up-to-5 s local shutdown in `before-quit`.
- Turbopack `.next/node_modules/<pkg>-<hash>` aliases become full copies, about 21 MB duplicated.
- Optional: replace the hand-written pnpm flattening in `build-server.mjs` with a `node-linker=hoisted` install (ponytail item, deferred by user).
