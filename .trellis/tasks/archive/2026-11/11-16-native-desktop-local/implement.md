# Implement — Desktop local mode

Branch `feat/native-desktop-local`, cut from `feat/native-desktop-remote`, which is not merged yet. Implement with Sonnet 5.5, check with Opus 5.5, then ponytail-review. Commit only after the user says so.

## Ordered checklist

### 1. Server: PGlite driver + spike fixes (rollback point A)
- [ ] Add `@electric-sql/pglite` to root deps.
- [ ] `db/client.ts` driver switch.
- [ ] `env.ts`: `DATABASE_URL` optional when `PGLITE_DATA_DIR` is set.
- [ ] The five fixes from design.md (setup queue, deleteMessage tx, compression plan outside the tx, two `execute()` normalizations) and the breakpoints in migrations `0000` and `0024`.
- [ ] Test harness:
  - `vitest.integration.pglite.ts` setupFile: a fresh in-memory DB per file, migrated.
  - `globalSetup` skips the Postgres migration when `PGLITE_DATA_DIR` is set.
  - Skip the three `pg_blocking_pids` tests on PGlite.
  - `waitFor` in `generation-runner:225`.
  - Explicit `createdAt` in the `generation-execution` fixture.
  - Reference: `research/pglite-spike.patch`. Port its production hunks without the `SPIKE` comments.
- [ ] Add the rule to `.trellis/spec/backend/database-guidelines.md`: no `getDb()` and no awaited network inside a transaction.

### 2. Server: local mode
- [ ] `env.ts`: `LOCAL_MODE` (booleanFlag), `LOCAL_ADMIN_PASSWORD`, `isLocalMode()`.
- [ ] `instrumentation.ts` boot checks, then migrate → provision → parentPort shutdown → runner.
- [ ] UI gating through props: `(app)/layout` → `AppShell` → `AppSidebar` / `AssistantTree` / `SettingsNav` / `SidebarUserMenu`. The account/users page redirects.
- [ ] `next.config.ts` `serverExternalPackages`. Build standalone and confirm the pglite assets are present.
- [ ] Tests:
  - provisioning: creates the admin once, is idempotent, sets the quota to null;
  - gating: nav and menu props;
  - boot validation.

### 3. Desktop shell (rollback point B)
- [ ] `local-server.ts` (secrets, port, spawn, ready, log, shutdown, sign-in).
- [ ] `store.ts` gains `localPort`.
- [ ] `main.ts`:
  - `connect("local")` with partition `persist:local`;
  - `/sign-in` and `/setup` interception;
  - "This computer" in the switcher menu and tray;
  - `before-quit` shutdown;
  - `openLocalLog`.
- [ ] Preload and the `host.ts` contract.
- [ ] shell-ui: welcome view, pinned row, local failure view. i18n for en + zh-CN.
- [ ] `scripts/build-server.mjs` plus electron-builder `extraResources`.

### 4. Release / CI / docs
- [ ] `ci.yml`: PGlite integration job.
- [ ] `release.yml`:
  - `build-desktop` builds the root standalone and runs `build-server`;
  - the macOS matrix splits into intel and arm64 runners;
  - each mac job passes `--x64` or `--arm64`.
- [ ] README (en + zh-CN) desktop section: local mode, data location.
- [ ] Spec: `guides/native-shell.md` (local mode contract) and a new `backend/local-mode.md`, following the demo-mode spec structure.

## Validation
- `pnpm lint && pnpm typecheck && pnpm test` (root), with integration on Postgres.
- `PGLITE_DATA_DIR=memory:// pnpm vitest run --project integration`.
- `pnpm -C native lint typecheck test`.
- `DOCKER_BUILD=1 pnpm build && node native/desktop/scripts/build-server.mjs && pnpm -C native/desktop dist --linux AppImage`, then launch the AppImage and check:
  - the welcome view appears;
  - choosing "This computer" lands on the chat page without login;
  - after a restart, the data and drafts are still there;
  - `ss -ltnp` shows the server bound only to `127.0.0.1`.

## Risky points
- Standalone tracing of the pglite assets, and pnpm symlinks inside the copied server tree on Windows. Both are verified on a local build; Windows/macOS are deferred to an rc tag.
- Electron `utilityProcess` running Next's `server.js` (Node 24.22). If it misbehaves, fall back to `spawn(process.execPath, { env: ELECTRON_RUN_AS_NODE=1 })`.
- `safeStorage` on Linux without a keyring falls back to the `basic_text` backend. It still works, and that is accepted.
