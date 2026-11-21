# Local Mode (Electron Embedded Server & Single-SQLite Runtime)

> Env-gated desktop local mode: in-process SQLite (`better-sqlite3`) database,
> boot-time auto-migration, silent local-admin provisioning, and auth/settings UI
> lockdown.

## Scenario: touching `DATABASE_PATH`, `LOCAL_MODE`, desktop packaging, or local-mode boot/UI gating

### 1. Scope / Trigger

Any change to `DATABASE_PATH`, `DATABASE_URL` (PostgreSQL boot importer),
`LOCAL_MODE`, `LOCAL_ADMIN_PASSWORD`, `src/server/db/client.ts`,
`src/server/services/setup.service.ts` (`ensureLocalAdmin`),
`native/desktop/src/local-server.ts`, `native/desktop/scripts/build-server.mjs`,
or local-mode UI conditionals.

### 2. Signatures

- `src/server/env.ts` (`envSchema`):
  - `DATABASE_PATH`: **required** non-empty string — SQLite database path (or `":memory:"` for ephemeral builds/tests; defaults to `/data/files/pika-chat.db` in Docker and `<userData>/local/pika-chat.db` in desktop local mode).
  - `DATABASE_URL`: optional `postgres://...` URI used strictly for one-time PostgreSQL boot import (`src/server/db/import-postgres.ts`).
  - `LOCAL_MODE`: optional env flag parsed with `envBoolean`. When set, activates desktop local mode; UI hides `/setup`, sign-in/sign-up, sign-out, 2FA, and user management while silently signing Electron into the seeded `local` super-admin account.
  - `LOCAL_ADMIN_PASSWORD`: optional string (min 16 chars), **required** at boot whenever `LOCAL_MODE` is enabled.
- `src/server/db/client.ts`:
  - `getDb(): BetterSQLite3Database<typeof schema>` — lazily opens and caches a single `better-sqlite3` instance on `globalThis.sqlite` with `WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`, and deterministic `file_basename` / `file_extension` UDFs.
  - `getSqliteClient(): Database.Database` — returns the underlying `better-sqlite3` connection for pragmas/manual transactions.
  - `closeDb(): void` — closes `globalThis.sqlite` cleanly (checkpoints WAL on quit) and resets the cached Drizzle wrapper.
- `native/desktop/src/local-server.ts`:
  - `localPaths()` puts SQLite at `<userData>/local/pika-chat.db` (`dbFile`) and passes `DATABASE_PATH: paths.dbFile` with a stripped `INHERITED_ENV` whitelist (never forwarding `DATABASE_URL` or host overrides). Prior pre-release `<userData>/local/db/` PGlite folders are left untouched.
- `native/desktop/scripts/build-server.mjs`:
  - Flattens standalone `node_modules` & `.next/node_modules` aliases, strips `prebuilds/`, compiles `better-sqlite3` for Electron's headers via `@electron/rebuild`, installs `build/Release/better_sqlite3.node`, and runs an `ELECTRON_RUN_AS_NODE=1` smoke check before exiting.

### 3. Contracts

| Concern | Contract |
|---|---|
| Single engine | Both server (`node server.js`), desktop local mode, and Vitest integration tests use `better-sqlite3` (`sqlite-core` schema + unified migrations under `src/server/db/migrations`) |
| Write concurrency | Use synchronous `db.transaction(fn, { behavior: "immediate" })` instead of async transactions or `SELECT ... FOR UPDATE`; never `await` I/O inside a transaction |
| Boot order | `instrumentation.ts` validates env → `S3_DIRECT_ACCESS` / `DEMO_MODE` guards → `getFileStorage()` → `migrate(getDb(), ...)` → `maybeImportPostgres()` → (if `LOCAL_MODE`) validate `LOCAL_ADMIN_PASSWORD`, `ensureLocalAdmin()`, register `parentPort` `"shutdown"` handler calling `closeDb()` → `startGenerationRunner()` |
| Electron native ABI | `pnpm -C native install --frozen-lockfile` must run **before** `node native/desktop/scripts/build-server.mjs` so `@electron/rebuild` and the target `electron` binary are present for ABI compilation and the `ELECTRON_RUN_AS_NODE=1` smoke check |

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| `DATABASE_PATH` unset or empty | `getEnv()` throws `Invalid environment` |
| `LOCAL_MODE=1` without `LOCAL_ADMIN_PASSWORD` | `register()` boot error |
| Desktop `better-sqlite3` ABI mismatch in `build-server.mjs` | `ELECTRON_RUN_AS_NODE=1` smoke check fails build immediately |

### 5. Good / Base / Bad Cases

- Good: Desktop spawns `utilityProcess` with `LOCAL_MODE=1`, `DATABASE_PATH=<userData>/local/pika-chat.db`, `LOCAL_ADMIN_PASSWORD=<secret>`, and a whitelisted environment that strips any host `DATABASE_URL`.
- Base: Server deployment sets `DATABASE_PATH=/data/files/pika-chat.db` with `LOCAL_MODE` unset; `DATABASE_URL` triggers a one-time PG import only while `postgres_import` marker is absent and the target DB has no user data.
- Bad: Leaving `prebuilds/` unstripped after `@electron/rebuild` without running `ELECTRON_RUN_AS_NODE=1` verification, or placing `node native/desktop/scripts/build-server.mjs` before `pnpm -C native install --frozen-lockfile` in CI.

### 6. Tests & CI Verification

- `src/server/env.test.ts`: `DATABASE_PATH` required, `DATABASE_URL` optional, `register()` rejects `LOCAL_MODE` without `LOCAL_ADMIN_PASSWORD`.
- `node native/desktop/scripts/build-server.mjs`: built-in `ELECTRON_RUN_AS_NODE=1` smoke check loads every bundled `better-sqlite3` module inside Electron and runs `select sqlite_version()`.
- `.github/workflows/ci.yml`: `desktop-smoke` (`workflow_dispatch`-only 4-OS matrix) exercises `pnpm build`, `build-server.mjs`, and `pnpm -C native/desktop dist` across Linux, Windows, macOS Intel, and macOS Apple Silicon.
