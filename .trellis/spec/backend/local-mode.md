# Local Mode Contract

> Env-gated desktop local mode: the bundled Next standalone server on an
> embedded SQLite file, single-admin provisioning, graceful `parentPort`
> shutdown, and hidden multi-user/account UI. Landed with
> `11-16-native-desktop-local`; moved from PGlite to SQLite with
> `11-20-sqlite-migration`.

## Scenario: touching `LOCAL_MODE`, the desktop server env/packaging, or local-mode boot/UI gating

### 1. Scope / Trigger

Any change to `LOCAL_MODE`, `LOCAL_ADMIN_PASSWORD`, boot provisioning/shutdown
in `src/instrumentation.ts`, `ensureLocalAdmin`, local-mode prop gating in
`(app)/layout.tsx` and its child navigation components,
`native/desktop/src/local-server.ts`, or
`native/desktop/scripts/build-server.mjs`.

Local mode is not a separate database path any more. Server, desktop and tests
all run the same `better-sqlite3` client, schema and migrations (see
[Database Guidelines](./database-guidelines.md)); local mode only chooses where
the file lives and switches product behaviour.

### 2. Signatures

- Env (`src/server/env.ts`):
  - `DATABASE_PATH`: required non-empty string. The desktop passes
    `<userData>/local/pika-chat.db`.
  - `LOCAL_MODE`: `booleanFlag` (`"1" | "true"` enables; `"0" | "false" | ""`
    normalizes to unset).
  - `LOCAL_ADMIN_PASSWORD`: optional non-empty string; required at boot when
    `LOCAL_MODE` is enabled.
  - `isLocalMode(): boolean`.
- DB (`src/server/db/client.ts`): `closeDb(): void` closes the cached
  `globalThis.sqlite` handle (the last close checkpoints the WAL) and clears the
  Drizzle wrapper; only the local-mode shutdown hook calls it.
- Provisioning (`src/server/services/setup.service.ts`):
  - `ensureLocalAdmin(password: string): Promise<void>` — idempotent; when
    `users` is empty, sets `app_settings.file_storage_quota_bytes = null`
    (unlimited) first, then creates `local` / `local@pika.local`
    (`role: "super_admin"`).
- UI gating (server-to-client props, no client context):
  - `(app)/layout.tsx` passes `local={isLocalMode()}` to `AppShell` →
    `AppSidebar` → `AssistantTree` / `SettingsNav` and `SidebarUserMenu`.
  - `/settings/account` and `/settings/users` redirect to `/settings/general`
    when `isLocalMode()` is true.
- Desktop (`native/desktop/src/local-server.ts`): `localPaths()` returns
  `root = <userData>/local`, `dbFile = <root>/pika-chat.db`, `filesDir`,
  `logFile`, `secretsFile`. The child env is the `INHERITED_ENV` whitelist plus
  `LOCAL_MODE=1`, `DATABASE_PATH=dbFile`, `FILE_STORAGE_DIR`, the secrets and
  `LOCAL_ADMIN_PASSWORD`; the user's `DATABASE_URL`, `S3_*`, `NODE_OPTIONS`
  etc. are never inherited, so the PostgreSQL import never runs in local mode.

### 3. Contracts

| Concern | Rule |
|---|---|
| Boot order | `register()`: env checks (`S3_DIRECT_ACCESS`, `DEMO_MODE`) → `getFileStorage()` → `migrate()` (every mode) → `maybeImportPostgres()` (no-op without a `DATABASE_URL` / `POSTGRES_*` connection) → if local: require `LOCAL_ADMIN_PASSWORD`, `ensureLocalAdmin()`, register the `parentPort` `"shutdown"` handler → `startGenerationRunner()` |
| Shutdown | Electron sends `"shutdown"` via `utilityProcess.postMessage`; the server calls `closeDb()` then `process.exit(0)`. On Windows `kill()` would give SQLite no chance to close cleanly |
| Data location | `<userData>/local/pika-chat.db` (+ `-wal` / `-shm`), created with its parent on first boot. The rc.1 PGlite directory `<userData>/local/db/` is neither read, migrated nor deleted, so a downgrade to rc.1 still finds its data |
| Storage quota | Global `app_settings.file_storage_quota_bytes` is cleared to `null` at provisioning; the local user has unlimited storage |
| Hidden UI | `showUsers` is `false`, `SettingsNav` omits `Account` and `Users`, `SidebarUserMenu` omits sign-out and shows `native.serverName` without `host:port` |
| No API blocks | Account/user endpoints are not blocked server-side in local mode because the server binds `127.0.0.1` and only the local user has the session |
| Native module | Nothing is compiled. better-sqlite3 13 is an N-API addon whose package ships prebuilds (`prebuilds/<linux\|linuxmusl\|darwin\|win32>-<x64\|arm64>.node`), and its loader uses them whenever no `build/Release` binary exists. `pnpm-workspace.yaml` sets `allowBuilds: better-sqlite3: false`, so installs never run its `node-gyp` script (the Docker image needs no compiler). `build-server.mjs` runs `ELECTRON_RUN_AS_NODE=1 electron -e`, which requires every bundled copy (top-level and `.next/node_modules/better-sqlite3-<hash>` alias), opens `:memory:` and queries `sqlite_version()`; any failure fails the build. `pnpm -C native install` must run first (it provides `electron`) |

The smoke check is the packaging guarantee and must never be skipped: it is
what catches a better-sqlite3 upgrade that drops N-API or a prebuild target.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| `DATABASE_PATH` unset or empty | `getEnv()` throws `Invalid environment` |
| `LOCAL_MODE=1` without `LOCAL_ADMIN_PASSWORD` | `register()` boot error |
| Non-`nodejs` `NEXT_RUNTIME` | `register()` skips Node-only boot checks, migration and runner |
| `/settings/account` or `/settings/users` in `LOCAL_MODE=1` | Server redirect to `/settings/general` |
| Bundled `better-sqlite3` fails to load in Electron | `build-server.mjs` exits non-zero before packaging |

### 5. Good/Base/Bad Cases

- Good: first local boot creates `<userData>/local/pika-chat.db`, migrates it,
  creates the `local` super admin and clears the global quota to `null`;
  later boots leave existing users and data untouched.
- Base: `LOCAL_MODE` unset — the same client and migrations run against the
  server's `DATABASE_PATH`, and `isLocalMode()` is `false`.
- Bad: forwarding the user's shell env to the child. A `DATABASE_URL` there
  would trigger a PostgreSQL import into the local database on first boot.

### 6. Tests Required

- `src/server/env.test.ts`: `DATABASE_PATH` required, `DATABASE_URL` optional;
  `register()` rejects `LOCAL_MODE` without `LOCAL_ADMIN_PASSWORD`.
- `src/server/services/local-setup.service.integration.test.ts`:
  `ensureLocalAdmin()` creates the super admin once, sets the global quota to
  `null`, is idempotent, and allows username sign-in with unlimited effective
  quota.
- `src/components/layout/SettingsNav.test.tsx` & `SidebarUserMenu.test.tsx`:
  the `local` prop hides Account/Users tabs, hides Sign out, and renders plain
  `serverName`.
- Packaging: the built-in smoke check in `build-server.mjs` runs in every
  release build; the `workflow_dispatch`-only `desktop-smoke` job in `ci.yml`
  runs `pnpm build`, `build-server.mjs` and `dist` on all four desktop targets
  without publishing.

### 7. Wrong vs Correct

#### Wrong

```ts
// Inheriting the whole shell env: DATABASE_URL, S3_* or DEMO_MODE from the
// user's terminal reconfigure the local server.
utilityProcess.fork(serverJs, [], { env: { ...process.env, LOCAL_MODE: "1" } });
```

#### Correct

```ts
// Whitelist what the platform needs, then set every server variable explicitly.
env: {
  ...Object.fromEntries(INHERITED_ENV.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]]))),
  LOCAL_MODE: "1",
  DATABASE_PATH: paths.dbFile,
  FILE_STORAGE_DIR: paths.filesDir,
}
```
