# Design — Desktop local mode

Refines the "Local mode" contract in the parent `design.md`. Evidence comes from `research/pglite-spike.md`; the patch is in `research/pglite-spike.patch`.

## Boundaries

```
Electron main (native/desktop)
  ├─ local-server.ts   secrets, port, data dir, utilityProcess lifecycle, sign-in
  ├─ main.ts           "local" entry in connect / switcher menu / tray; sign-in redirect interception
  └─ extraResources/server/   Next standalone + static + public + migrations (outside asar)
        │ utilityProcess.fork(server.js, env)
        ▼
Next server (LOCAL_MODE=1, PGLITE_DATA_DIR=<userData>/local/db)
  ├─ db/client.ts          PGlite driver when PGLITE_DATA_DIR is set
  ├─ instrumentation.ts    migrate → provision local admin → parentPort shutdown → generation runner
  └─ UI gating             account/users pages, sign-out, registration toggle hidden
```

The two switches are separate:
- `PGLITE_DATA_DIR` only selects the driver. The PGlite CI job sets it on its own, with `memory://`.
- `LOCAL_MODE` gates product behaviour and requires `PGLITE_DATA_DIR`.

## Server changes

### Driver (`src/server/db/client.ts`)
- When `PGLITE_DATA_DIR` is set, use `drizzle-orm/pglite` with `new PGlite(dir)`. The instance is kept on `globalThis`, because module reloads (Next dev, `vi.resetModules`) must not open a second, empty DB. Otherwise use postgres-js unchanged.
- `DbClient` becomes `PgDatabase<PgQueryResultHKT, typeof schema>`. `tsc` is clean with this type, including better-auth's adapter (spike).
- In `src/server/env.ts`, `DATABASE_URL` becomes optional only when `PGLITE_DATA_DIR` is set. This uses a schema refinement, not a new fallback path.

### PGlite correctness fixes (all from the spike; they also run on Postgres)
| Site | Problem | Fix |
|---|---|---|
| `setup.service.ts:22` `createFirstAdmin` | `assertUsernameAvailable` and better-auth `createUser` use `getDb()` inside a tx, which deadlocks | Drop the tx. Serialize setup with an in-process promise queue, then count users and create. Multi-replica first-setup races are not a supported deployment. |
| `message.service.ts:720` `deleteMessage` | `assertTargetNotCompressed` / `listTopicRows` use `getDb()` inside a tx | Pass `tx` through |
| `compression.service.ts:242` manual compaction | Plans (reads + `generateText` ≤30 s) inside a tx | Lock and assert the topic is idle, plan outside the tx, then re-lock, assert idle again and write |
| `generation.service.ts:119` `databaseNow`, `demo-usage.service.ts:33` | `execute()` returns `{rows}` on PGlite but an array on postgres-js | Normalize at those two sites |
| migrations `0000`, `0024` | Several statements in one chunk; the PGlite migrator rejects them (42601) | Add `--> statement-breakpoint`. The drizzle migrator does not hash files, so existing DBs are unaffected. |

Rule (into `database-guidelines.md`): never call `getDb()` inside a transaction callback, and never await network inside a transaction. On PGlite either one hangs the whole server. The PGlite CI job enforces the tested paths. No runtime guard is added.

### Boot in local mode (`src/instrumentation.ts`, `LOCAL_MODE` branch)
1. Run `drizzle-orm/pglite/migrator` against `./src/server/db/migrations`, relative to the server cwd, the same path the Docker image uses.
2. Provision: if `users` is empty, create the super admin `local` / `local@localhost` with `LOCAL_ADMIN_PASSWORD`, and set the instance default storage quota to `null` (unlimited).
3. `process.parentPort?.on("message", "shutdown")`: close PGlite, then `process.exit(0)`. This works on every platform; on Windows `kill()` does not let the process clean up.
4. Start the generation runner. It already recovers turns a killed process left running.

Boot validation: `LOCAL_MODE` without `PGLITE_DATA_DIR` or `LOCAL_ADMIN_PASSWORD` is a boot error. This follows the existing `DEMO_MODE` check style.

### Web gating (`isLocalMode()` in `src/server/env.ts`)
Process-level checks only, like demo mode. Server components read the flag and pass props; no new client context.
- The `(app)` layout passes `local` to `AppShell` → `AppSidebar`.
- `showUsers` is false when local. `SettingsNav` gets a prop that hides the Account tab.
- `SidebarUserMenu` hides sign-out and shows only `serverName`, with no `127.0.0.1:port`.
- `/settings/account` and `/settings/users` redirect to `/settings/general` when local.
- The registration toggle and 2FA are hidden with those pages. There are no server-side API blocks: only the local user can reach the API, and the UI no longer offers these actions.

### Packaging the server
- `next.config.ts`: add `serverExternalPackages: ["@electric-sql/pglite"]`. Verify that standalone tracing copies `pglite.wasm` / `pglite.data` / `initdb.wasm`; if it does not, add `outputFileTracingIncludes`. The standalone build reuses `DOCKER_BUILD=1`.
- `native/desktop/scripts/build-server.mjs` (one script, run before `dist`) assembles `native/desktop/server/`:
  - `.next/standalone/*`
  - `.next/static` → `server/.next/static`
  - `public`
  - `src/server/db/migrations`
  It must dereference pnpm symlinks so the result is a plain tree on Windows and inside installers.
- electron-builder: `extraResources: [{ from: "server", to: "server" }]`, outside asar.
- sharp binaries match the host arch, so every installer is built on a runner of its own arch. The release matrix splits macOS into `macos-15-intel` (x64) and `macos-latest` (arm64) jobs. Windows and Linux stay x64.

## Shell changes (`native/desktop`)

### `local-server.ts`
- **Paths:** everything lives under `<userData>/local/`: `db/`, `files/` (`FILE_STORAGE_DIR`), `server.log`, `secrets.bin`. It survives app updates and reinstalls.
- **Secrets:** `BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_SECRET` and `LOCAL_ADMIN_PASSWORD` are generated once (`randomBytes`), stored as `safeStorage.encryptString(JSON)`, and passed as env.
  - If decryption fails, show a shell-ui error. Never regenerate: new secrets would orphan the stored provider keys and the admin password.
- **Port:** the first start binds `127.0.0.1:0`, reads the port and saves `localPort` in `config.json`. Later starts reuse it, and pick a new one only if it is taken. This keeps localStorage, which is origin-scoped.
- **Process:**
  - `utilityProcess.fork(server/server.js, { cwd: server, env, stdio: "pipe" })`.
  - Env: `NODE_ENV=production`, `HOSTNAME=127.0.0.1`, `PORT`, `APP_URL=http://127.0.0.1:<port>`, `LOCAL_MODE=1`, `PGLITE_DATA_DIR`, `FILE_STORAGE_DIR`, plus the secrets.
  - stdout/stderr go to `server.log`, truncated on each start.
  - Ready means `GET /api/health` returns `ok`, polled with a 60 s budget. An early exit or a timeout is a startup failure.
- **Lifecycle:**
  - Starts the first time "This computer" is connected, including the auto-connect at launch.
  - Keeps running when the user switches to a remote server or closes to tray, so background generation continues and switching back is instant.
  - On `before-quit`: post `shutdown` and wait up to 5 s for exit, then kill.
  - `requestSingleInstanceLock()` already exists, and only the single instance starts the server. That rules out two processes on one data dir (corruption, spike).
- **Sign-in:** in partition `persist:local`, `session.fetch(origin/api/auth/get-session)`. If there is no session, `POST /api/auth/sign-in/username` with `local` + the password and an `Origin` header; cookies land in the partition. The remote view then loads `/`.
  - If the view ever navigates to `/sign-in` or `/setup` (session expired), main re-runs sign-in and loads `/`.

### Config, shell-ui contract and menus
- Config adds `localPort: number | null`. `lastServerId` may be `"local"`.
- `PikaShell` contract changes:
  - `connect("local")` runs start → ready → sign-in → load;
  - new `openLocalLog()` reveals `server.log` in the file manager.
- `connect` reports progress through the existing shell-ui status view, and failures through `?failed=local`. The `checkServer` / version check is skipped for local, because the bundled server always matches the shell.
- shell-ui:
  - The welcome view shows when there is nothing to auto-connect to (`lastServerId` is neither `"local"` nor a saved server) and `servers` is empty; no extra flag is stored. "Use on this computer" connects to local. "Connect to a server" opens the add form, and its Cancel returns to the list, not the welcome view.
  - After that, switching always goes through the list (`?list`), which is reached from the existing entry points (sidebar switcher, account menu, tray, auth chip). No separate mode setting.
  - The list renders a pinned "This computer" row first, with no edit or remove.
  - The local failure view shows the reason and an "Open log" button.
- The native switcher popup and the tray "Switch server" submenu list "This computer" first.
- `pikaNative.serverName` for local is the localized "This computer".
- i18n: shell-ui and desktop catalogs get keys for the welcome view, the local row, the local start/fail messages and "Open log".

## Release / CI
- `release.yml` `build-desktop`: root `pnpm install` + `DOCKER_BUILD=1 pnpm build` → `build-server.mjs` → desktop `dist`. The matrix gains the macOS split.
- `ci.yml`: a new job runs the integration project with `PGLITE_DATA_DIR=memory://`. The test harness migrates a fresh in-memory DB per file (~1 s). Three `pg_blocking_pids` lock-race tests are skipped on PGlite.
- The flaky PGlite tie in `generation-execution` (1 ms `now()` resolution) gets explicit `createdAt` values in its fixtures.

## Trade-offs
- PGlite serializes queries and blocks the event loop while they run. Acceptable for one local user (spike: no deadlock path remains in the generation runner).
- The setup-transaction change slightly weakens concurrent first-setup protection for multi-replica Postgres deployments. Accepted, because setup is a one-time, single-operator action.
- The server keeps running after switching away. It costs memory, and in exchange background turns finish.

## Compatibility / rollback
- Without `PGLITE_DATA_DIR` / `LOCAL_MODE`, the server behaves as before. The only shared-path edits are the five spike fixes and the migration breakpoints, which are behaviour-neutral on Postgres (verified 280/280).
- Downgrading the app after a newer migration ran is not supported, the same as Docker.
- Rollback means removing the local entry from the shell and dropping the `LOCAL_MODE` branches. The driver switch and the fixes can stay.
