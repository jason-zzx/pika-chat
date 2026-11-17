# Desktop local mode

Parent: `11-16-native-apps` (D2, D6; local-mode contract in parent `design.md`; `research/local-db-options.md`).
Depends on: `11-16-native-desktop-remote` (shell, shell-ui, packaging pipeline).

## Goal

The desktop app works with no server: choosing "Local" starts a bundled Pika server on this machine and the user chats immediately, without setup or login.

## Requirements (to be refined into design.md / implement.md before start)

- Spike first: run the existing integration tests against PGlite; choose PGlite or embedded-postgres.
- Bundle Next standalone output + Node runtime handling (Electron's Node via `utilityProcess`) + migrations; native modules (`sharp`) per platform/arch.
- `LOCAL_MODE=1`: bind `127.0.0.1` random port, auto-provision and auto-sign-in a local super admin, hide 2FA / registration / user management, redirect `/setup` and sign-in routes.
- Secrets generated once and stored with Electron `safeStorage`; data, files, and DB under the OS app-data dir.
- Server process lifecycle: start with app, stop on quit, surface startup failures in shell-ui.

## Acceptance Criteria (draft)

- [ ] Fresh install → "Local" → chat page appears with no setup/login; add a provider, chat, upload a file, generate an image.
- [ ] Data persists across app restarts and app updates.
- [ ] Port is not reachable from another machine on the LAN.
- [ ] Web/Docker deployments without `LOCAL_MODE` behave as before; existing tests pass.
