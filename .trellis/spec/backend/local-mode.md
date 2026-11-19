# Local Mode Contract

> Env-gated desktop local mode: in-process PGlite database, boot-time
> migration and single-admin provisioning, graceful `parentPort` shutdown, and
> hidden multi-user/account UI. Landed with `11-16-native-desktop-local`.

## Scenario: touching `PGLITE_DATA_DIR`, `LOCAL_MODE`, or local-mode boot/UI gating

### 1. Scope / Trigger

Any change to `PGLITE_DATA_DIR`, `LOCAL_MODE`, `LOCAL_ADMIN_PASSWORD`,
`src/server/db/client.ts` driver switching, boot provisioning/shutdown in
`src/instrumentation.ts`, or local-mode prop gating in `(app)/layout.tsx` and
its child navigation components.

**Two separate switches:**

- `PGLITE_DATA_DIR` selects the in-process PGlite driver (`drizzle-orm/pglite`)
  instead of `postgres-js`, and makes `DATABASE_URL` optional in `env.ts`. The
  PGlite CI job sets `PGLITE_DATA_DIR=memory://` without `LOCAL_MODE`.
- `LOCAL_MODE` gates product behaviour (boot migration, single super-admin
  provisioning, `parentPort` shutdown hook, hidden Account/Users UI and
  sign-out) and **requires** both `PGLITE_DATA_DIR` and
  `LOCAL_ADMIN_PASSWORD`.

### 2. Signatures

- Env (`src/server/env.ts`):
  - `PGLITE_DATA_DIR`: optional non-empty string (`memory://` or directory path).
    When unset, `DATABASE_URL` is required via schema `superRefine`.
  - `LOCAL_MODE`: `booleanFlag` (`"1" | "true"` enables; `"0" | "false" | ""`
    normalizes to unset).
  - `LOCAL_ADMIN_PASSWORD`: optional non-empty string; required at boot when
    `LOCAL_MODE` is enabled.
  - `isLocalMode(): boolean`.
- DB (`src/server/db/client.ts`):
  - `getDb(): PgDatabase<PgQueryResultHKT, typeof schema>` — caches the `PGlite`
    instance on `globalThis.pglite` so HMR / module resets never open a second
    handle against the same data directory.
  - `closeDb(): Promise<void>` — closes `globalThis.pglite` and clears the
    cached references (local-mode shutdown only).
  - `executeRows<T>(result: unknown): T[]` — normalizes `postgres-js` array
    results and PGlite `{ rows }` results.
- Provisioning (`src/server/services/setup.service.ts`):
  - `ensureLocalAdmin(password: string): Promise<void>` — idempotent; when
    `users` is empty, creates `local` / `local@pika.local` (`role: "super_admin"`)
    and sets `app_settings.file_storage_quota_bytes = null` (unlimited).
- UI gating (server-to-client props, no client context):
  - `(app)/layout.tsx` passes `local={isLocalMode()}` to `AppShell` →
    `AppSidebar` → `AssistantTree` / `SettingsNav` and `SidebarUserMenu`.
  - `/settings/account` and `/settings/users` redirect to `/settings/general`
    when `isLocalMode()` is true.

### 3. Contracts

| Concern | Rule |
|---|---|
| Driver isolation | Only `src/server/db/client.ts` switches on `PGLITE_DATA_DIR`; services stay driver-neutral via `PgDatabase` and `executeRows()` |
| PGlite concurrency | Single connection on Node main thread; never call `getDb()` or await network I/O inside `db.transaction()` |
| Boot order | `instrumentation.ts` validates env → `getFileStorage()` → (if local) validate `PGLITE_DATA_DIR` / `LOCAL_ADMIN_PASSWORD` → PGlite `migrate()` → `ensureLocalAdmin()` → register `parentPort` `"shutdown"` handler → `startGenerationRunner()` |
| Shutdown | Electron sends `"shutdown"` via `utilityProcess.postMessage`; server calls `closeDb()` then `process.exit(0)` |
| Storage quota | Global `app_settings.file_storage_quota_bytes` is cleared to `null` at provisioning; local user has unlimited storage |
| Hidden UI | `showUsers` is `false`, `SettingsNav` omits `Account` and `Users`, `SidebarUserMenu` omits sign-out and shows `native.serverName` without `host:port` |
| No API blocks | Account/user endpoints are not blocked server-side in local mode because the server binds `127.0.0.1` and only the local user has the session |

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| `DATABASE_URL` and `PGLITE_DATA_DIR` both unset | `getEnv()` throws `Invalid environment` |
| `LOCAL_MODE=1` without `PGLITE_DATA_DIR` | `register()` boot error |
| `LOCAL_MODE=1` without `LOCAL_ADMIN_PASSWORD` | `register()` boot error |
| Non-`nodejs` `NEXT_RUNTIME` | `register()` skips Node-only boot checks and runner |
| `/settings/account` or `/settings/users` in `LOCAL_MODE=1` | Server redirect to `/settings/general` |

### 5. Good/Base/Bad Cases

- Good: first local boot migrates empty `db/`, creates `local` super admin,
  clears global quota to `null`, and subsequent boots leave existing users and
  data untouched.
- Base: `PGLITE_DATA_DIR` unset — `postgres-js` is used unchanged and `isLocalMode()`
  is `false`.
- Bad: calling `getDb()` inside a `db.transaction()` callback — deadlocks PGlite's
  exclusive transaction mutex permanently.

### 6. Tests Required

- `src/server/env.test.ts`: `PGLITE_DATA_DIR` allows omitted `DATABASE_URL`;
  `register()` rejects `LOCAL_MODE` without `PGLITE_DATA_DIR` or
  `LOCAL_ADMIN_PASSWORD`.
- `src/server/services/local-setup.service.integration.test.ts`:
  `ensureLocalAdmin()` creates the super admin once, sets global quota to `null`,
  is idempotent, and allows username sign-in with unlimited effective quota.
- `src/components/layout/SettingsNav.test.tsx` & `SidebarUserMenu.test.tsx`:
  `local` prop hides Account/Users tabs, hides Sign out, and renders plain
  `serverName`.
- CI: `test-pglite` job runs `PGLITE_DATA_DIR=memory:// pnpm vitest run --project integration`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Deadlocks on PGlite: getDb() waits for the mutex held by db.transaction().
await db.transaction(async (tx) => {
  await assertUsernameAvailable(username); // internally calls getDb()
});
```

#### Correct

```ts
// Thread `tx` through every helper called inside a transaction, or run
// multi-step operations outside the lock with conditional writes.
await db.transaction(async (tx) => {
  await assertTargetNotCompressed(topicId, targetId, undefined, tx);
});
```
