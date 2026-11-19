# PGlite spike: integration suite on `@electric-sql/pglite`

Date: 2026-11-17. Throwaway worktree spike; diff in `pglite-spike.patch` (same folder).
Versions: `@electric-sql/pglite` 0.5.16 (latest, 2026-11-09; embeds PostgreSQL **18.6**, while the dev/prod server is 17),
`drizzle-orm` 0.45.2 (`drizzle-orm/pglite`, `drizzle-orm/pglite/migrator`), Node 24.22.2 (the task said Node 22; the local `node` is 24).

## Verdict

**Go with PGlite.** The full integration suite passes on PGlite after six small production-code changes, and none of
them is a refactor. The one real cost is that PGlite runs every transaction one after another on the Node main thread.
So no code path may call `getDb()` inside a transaction, and no transaction may wait on a network call. The repo has
three such sites today, and all three are fixed in the patch. A cheap guard can stop new ones from coming back.
embedded-postgres is not needed (sizes are below, for the record).

## Numbers

| Run | Files | Tests | Wall time |
|---|---|---|---|
| Baseline, real Postgres 17, unmodified | 27/27 pass | 280/280 pass | 111.2 s (1:52 total) |
| PGlite, first attempt (8 s timeouts) | 7 failed | 64 failed / 216 pass | 638 s (deadlocks wait out every timeout) |
| PGlite, with the patch | 27/27 pass | 277 pass + 3 skipped | 111.8 s (1:52 total) |
| PGlite, with the patch (2nd run) | 26/27 | 276 pass, 1 flaky (see F7), 3 skipped | 111.4 s |
| Real Postgres, with the patch (regression check) | 27/27 | 280/280 | 114.6 s |

- There were no failures on the baseline before the spike.
- Migrating a fresh in-memory PGlite takes **~1.0 s per test file** (min 0.86 s, max 1.38 s over 28 files). That
  makes up the 39 s "setup" line. Test time itself drops from 91 s to 63 s, because PGlite is in-process.
- On a plain on-disk data dir, the first boot (initdb) takes about 1.2 s and a reopen about 0.25 s. All 29 migrations
  take about 1 s more.

## Harness used (spike only)

- `src/server/db/client.ts`: `PGLITE_DATA_DIR` (`memory://` or a path) selects `drizzle-orm/pglite`. The PGlite
  instance is cached on `globalThis` (see F5).
- `vitest.integration.pglite.ts` (a new setupFile) runs `drizzle-orm/pglite/migrator` per test file, in the test
  worker. `globalSetup` returns early when `PGLITE_DATA_DIR` is set.
- `app-settings.integration.test.ts` opened its own postgres-js connection. It now uses `getDb()`.

## Failure classes

### F1 — Deadlock: `getDb()` inside a transaction (production code)

How PGlite locks (`@electric-sql/pglite/src/base.ts`): `transaction()` holds `_runExclusiveTransaction` for the whole
callback, and every `query()`/`exec()` outside it also waits on the same mutex. Any `getDb()` query issued from inside
a `db.transaction` callback therefore waits forever. There is no timeout and no error, and every later query hangs
behind it. The probe `spike/concurrency.mjs` shows this directly: "getDb() inside transaction: hung > 3s".

| Site | Call chain | Tests it broke | Fix in patch |
|---|---|---|---|
| `setup.service.ts:22` `createFirstAdmin` | `db.transaction` → `assertUsernameAvailable` (`account-create.ts:32`, `getDb()`) → `auth.api.createUser` (better-auth `drizzleAdapter(getDb())`, `auth/index.ts:118`) | Every test that calls `postSetup` (the whole of generation-runner and more; this was the first hang) | Removed the tx. Concurrent first-setup calls are serialized by an in-process promise queue, then: count users → check username → `createUser`. Local mode's auto-provisioning goes through this path too. |
| `message.service.ts:720` `deleteMessage` | `db.transaction` → `assertTargetNotCompressed` (`:245`, `getDb()`) → `listTopicRows` (`:221`, `getDb()`) | message.service (22), file.service (13; the first deadlock left the mutex held for good, so everything after it failed too) | `assertTargetNotCompressed` and `listTopicRows` take an optional executor; `deleteMessage` passes `tx`. |
| `compression.service.ts:242` manual (`exclusive`) compaction (route `api/topics/[id]/compress`) | `db.transaction` → `planCompression` → `getTopicSummaryState` (`:136`, `getDb()`), `listTopicMessages` → `requireOwnedTopic`/`listTopicRows` (`getDb()`), **then `generateText` (LLM, up to 30 s) inside the tx** | compression.service (13) | Same pattern as the auto path: tx(lock + assert idle) → plan outside the lock → tx(re-lock, assert idle, conditional `writeSummary`). `writeSummary` already refuses to write when the boundary moved. The difference is that a turn may now be admitted during the model call; the second `lockTopicAndAssertIdle` then refuses the write. This is a small behavior change that Postgres mode would also get. |

I checked the other 10 transaction sites by reading them (`assistant.service.ts:325`, `generation.service.ts:404`/`:803`,
`compression.service.ts:252`, `search-provider.service.ts:167`/`:206`, `topic.service.ts:122`, `message.service.ts:418`/`:536`/`:776`).
They use only `tx` or tx-accepting helpers. `topic.service.ts` `ownedAssistantIds()` calls `getDb().select()`, but it
only builds a subquery that is inlined into the tx statement and never runs on its own, so it is safe. The heuristic scan
`spike/scan_tx.py` (functions that take a tx/executor and also call `getDb()`) finds only `tx ?? getDb()` fallbacks.

### F2 — Driver result shape: `db.execute()` (production code)

postgres-js returns a row array. PGlite returns `{ rows, fields, affectedRows }`.

| Site | Symptom | Fix |
|---|---|---|
| `generation.service.ts:119` `databaseNow()` | `rows[0]` is undefined, so it throws `AppError INTERNAL "generic"` on every admission with a request id (8 generation.service tests) | Normalize to `Array.isArray(r) ? r : r.rows` |
| `demo-usage.service.ts:33` `consumeDemoQuota` | `rows.length` is undefined, so every guest quota check returns false (2 demo-usage tests) | Same normalization |
| `health.service.ts:9` | Ignores the result, so it is fine | — |

A clean production version would make these sites driver-neutral, rather than keep the `Array.isArray` check:
`databaseNow` could be replaced with an `insert … returning`, a `select now()` through the query builder, or simply
`new Date()` in local mode, where the DB and app share one clock.

Parsing also differs. On PGlite, `sum(...)::bigint` arrives as a JS **number** (postgres-js gives a string),
`numeric` as a string, `timestamptz` as a `Date`, and `jsonb` as an object. `quota.ts:22` wraps the value in
`Number(...)`, so it works with both. The `databaseNow` comment at `:123` already accepts both Date and string.

### F3 — Migration SQL: several statements in one chunk (migration files)

`0000_aberrant_war_machine.sql` and `0024_young_natasha_romanoff.sql` are hand-written with several statements and no
`--> statement-breakpoint`. The PGlite migrator sends each chunk through the extended protocol, which fails with
`42601 cannot insert multiple commands into a prepared statement`. postgres-js runs them through the simple protocol.
The fix is to add the breakpoints (patch). This is safe for existing databases: the drizzle migrator only compares
`created_at`/folder millis, not the file hash. Real Postgres still passes 280/280. Future hand-written migrations
need breakpoints as a convention (a check in the migration-review spec or a lint would enforce it).

There was **no SQL incompatibility** otherwise. All 29 migrations and every query ran unchanged, including `FOR UPDATE`,
`ilike`, jsonb `->>`, `on conflict … where`, and partial unique indexes. PGlite is PG 18.6, the server is PG 17.

### F4 — Test-only: multi-connection lock tests

`generation-runner.integration.test.ts` "waits for the real in-flight checkpoint…" (`:443`) and "cleans an image
committed while %s deletion waits for the topic lock" (`:513`, 2 cases) open a transaction holding a row lock, then
poll `pg_stat_activity` / `pg_blocking_pids()` from a second connection. PGlite has one connection, so these tests
cannot be expressed against it. They are skipped with `it.skipIf(process.env.PGLITE_DATA_DIR)`. Their invariants
(terminal write vs checkpoint ordering, delete vs finalize) hold trivially under PGlite's full serialization. They
keep running on Postgres.

### F5 — Test-only: `vi.resetModules()` gives a second, empty database

`demo-mode.integration.test.ts` re-imports `@/server/db/client` after `vi.resetModules()`. That created a fresh,
unmigrated `memory://` PGlite (`relation "provider_configs" does not exist`). The fix is to keep the PGlite instance on
`globalThis`. Production needs this anyway: Next dev HMR and any duplicated module instance must not open a second
PGlite on the same data dir (see the corruption risk in P4).

### F6 — Test-only: event-loop timing ("stops a running turn…", `:225`)

`expect(provider.aborted).toBe(1)` straight after `await entry.settled` failed under PGlite. The fake provider's
`response.on("close")` had not been processed yet, because PGlite queries run synchronously in WASM and never give
the I/O phase a chance to run (see C2). The fix is `await waitFor(() => provider.aborted === 1)`, the same form the
test already uses at `:278`.

### F7 — Test-only flake: PGlite `now()` has millisecond resolution

`generation-execution.integration.test.ts` "announces the placeholder's group/version identity…" failed once in two
full runs and passed 5 of 5 times in isolation. `topicWithHistory` seeds rows using the DB default `created_at`. In
PGlite, `now()` and `clock_timestamp()` resolve only to **1 ms** (`spike/clock.mjs`: `…35.904000` repeated), so
back-to-back inserts tie. The tie is broken by a random `msg-…` id, so `messages[1]` is sometimes the user message.
Production rows take app-side `Date` timestamps, which are ms precision on both drivers, so the risk there is low. Any
ordering that relies on DB-default timestamps for rows inserted within 1 ms is unstable on PGlite. Fix the test by
passing explicit `createdAt` values (not done in the spike).

## Concurrency / deadlock risk (C)

Model: PGlite gives one connection with fully serialized transactions, and everything executes on the Node main
thread. That is stronger isolation than READ COMMITTED, so `FOR UPDATE` and the parent→child lock order are
trivially satisfied. Correctness holds; liveness is the risk.

- **C1 — `getDb()` inside a tx means a permanent hang of the whole server.** One such call freezes every request, the
  generation runner, and the sweeper. It never recovers, because the mutex is never released. There were three
  instances in the repo (F1). All are fixed in the patch.
  Guard proposal: in local mode, wrap `getDb()` so that it throws when called inside an `AsyncLocalStorage` context
  that `db.transaction` sets. About 15 lines, and it turns a silent hang into a stack trace. Alternatively, run the
  integration suite on PGlite in CI, which catches these as timeouts.
- **C2 — The event loop stalls during queries.** WASM execution is synchronous. A 563 ms query let a 10 ms
  `setInterval` fire **0 times** (`spike/concurrency.mjs`). Background generation streams SSE chunks and writes
  checkpoints on the same thread. The app's queries are small (per-topic or per-user lookups), so this is acceptable
  for one local user. Avoid large scans (orphan sweep, receipt purge) on hot paths. Moving PGlite into a worker
  (`@electric-sql/pglite/worker`) is possible later, but not needed.
- **C3 — A transaction that awaits I/O blocks the whole DB.** A plain query issued during a 1 s transaction waited
  1002 ms (probe). The only site was manual compaction holding a tx across `generateText` (up to
  `SUMMARY_TIMEOUT_MS` = 30 s). Fixed in F1. `createFirstAdmin` awaited scrypt hashing inside its tx; fixed by
  removing the tx. Every other transaction contains only DB statements.
- **C4 — Generation runner.** I read `src/server/ai/generation-runner.ts`. Claim, checkpoints (10 s timer), status
  reads and stop are single statements. `finalizeGeneration` (`generation.service.ts:803`) is a short tx with only
  `tx` statements. Admission (`:404`) likewise; `consumeGuestModelTurnQuota` gets `tx`. Title generation and auto
  compaction call the model outside any tx. There is no remaining runner deadlock path. Concurrent turns simply
  serialize their DB writes.
- **C5 — Nested `executor.transaction`** (`message.service.ts:418`/`:536`, where executor may be a tx) becomes a
  savepoint in drizzle-pglite. It works.

## Packaging notes (P)

- **P1 — Node compat.** It loads from a plain `node` ESM script (`spike/persist.mjs`). With an on-disk data dir it
  persists across restarts (row count 1 → 2). An empty cluster is **39 MB** on disk. PGlite reserves a 128 MB
  initial WASM memory (max 2 GB).
- **P2 — Install size.** `du -sh node_modules/@electric-sql/pglite` = **27 MB**. Of that: `pglite.wasm` 9.1 MB
  (3.3 MB gzipped), `pglite.data` 6.2 MB (1.9 MB gzipped), `initdb.wasm` 0.3 MB, sourcemaps 6 MB, contrib extension
  tarballs 1.5 MB, plus `fs`/`node-postgres`/`worker`/`live` helpers. The runtime needs only about 16 MB.
- **P3 — Asset loading and Next standalone.** The package resolves its assets with
  `new URL('./pglite.wasm' | './pglite.data' | './initdb.wasm', import.meta.url)` (`dist/chunk-XZUEO4BZ.js`,
  `dist/initdb.js`) and reads them through `fs` in Node. `@electric-sql/pglite` is **not** on Next 16's built-in
  `server-external-packages.jsonc` list (only `pg` is). So:
  - add `serverExternalPackages: ["@electric-sql/pglite"]`, so it is `require`d from `node_modules` and not bundled
    by Turbopack;
  - verify that standalone tracing copies the three asset files. If it does not, add
    `outputFileTracingIncludes: { "/**": ["node_modules/@electric-sql/pglite/dist/*.{wasm,data}"] }`.

  A belt-and-braces option needs no tracing at all: PGlite accepts `wasmModule`, `initdbWasmModule` and `fsBundle`
  options, so the server can read the three files from a known resource path and pass them in. I did not build Next.
- **P4 — No multi-process lock.** Two processes opened the same data dir at the same time without any error
  (`spike/hold.mjs`), and **one process's committed insert was lost**: 3 + 1 + 1 inserts gave a final count of 4, not
  5. The desktop shell must enforce a single instance (Electron `app.requestSingleInstanceLock()`) and hold a lockfile
  in the data dir before starting the server. In-process, use the single `globalThis` instance (F5).
- **P5 — Migrations at boot.** Today `scripts/migrate.ts` (postgres-js) runs before `server.js`. Local mode needs a
  PGlite variant using `drizzle-orm/pglite/migrator`, run in the same process that owns the data dir (only one process
  may open it, P4). Run it before the runner starts in `instrumentation.ts`, or in the server entry.

## Required production changes for PGlite local mode

1. `db/client.ts`: driver switch on a local-mode env var (e.g. `PGLITE_DATA_DIR`), one instance kept on
   `globalThis`, close on shutdown. Type `db` as `PgDatabase<PgQueryResultHKT, typeof schema>`: with that, `tsc` is
   clean across services, routes and better-auth's `drizzleAdapter` (the patch's final `client.ts`). The only fallout
   is `execute()` results becoming `unknown`: 2 service sites plus 3 Postgres-only test lines, cast in the patch.
2. `setup.service.ts` `createFirstAdmin`: no `getDb()`/better-auth calls inside a tx (patch: in-process serialization;
   a Postgres deployment with several app replicas would want a unique-constraint or retry instead).
3. `message.service.ts` `deleteMessage` → `assertTargetNotCompressed`/`listTopicRows` take `tx`.
4. `compression.service.ts` manual compaction: no tx around `planCompression`/`generateText`.
5. `generation.service.ts` `databaseNow` and `demo-usage.service.ts` `consumeDemoQuota`: driver-neutral `execute()`
   result handling.
6. Migrations `0000` and `0024`: add `--> statement-breakpoint`, and adopt it as a convention for hand-written SQL.
7. Boot: a PGlite migrator step; `serverExternalPackages` plus asset tracing (P3); a single-instance lock in the
   shell (P4).
8. Recommended: the C1 `AsyncLocalStorage` guard, and a CI job running `PGLITE_DATA_DIR=memory:// vitest --project
   integration`. The test harness pieces (setupFile migrate, `skipIf` for the 3 lock tests, `waitFor` at `:225`,
   explicit `createdAt` in `topicWithHistory`) are in the patch, except the last one.

Each item is local, and all of them are compatible with Postgres. Real Postgres passes 280/280 with the patch applied.

## embedded-postgres (fallback, not needed)

npm `embedded-postgres` 18.6.0-beta.19. Every release is tagged `-beta`. It ships binaries per platform as
optionalDependencies. Unpacked sizes (18.6 / 17.7):

| Package | 18.6.0-beta.19 | 17.7.0-beta.15 |
|---|---|---|
| `@embedded-postgres/linux-x64` | 59 MB | 58 MB |
| `@embedded-postgres/linux-arm64` | 59 MB | — |
| `@embedded-postgres/darwin-x64` | 337 MB | — |
| `@embedded-postgres/darwin-arm64` | 337 MB | 136 MB |
| `@embedded-postgres/windows-x64` | 109 MB | 102 MB |

It supports Windows x64 only, with no Windows arm64 package. It keeps postgres-js unchanged and has none of F1–F3 or
C1–C3. In exchange it costs 60–340 MB per platform, plus a child-process lifecycle (port, crash recovery, orphaned
`postmaster.pid` after a hard kill, initdb on first launch), and macOS signing/notarization of every bundled binary.
PGlite's fixes are cheaper than that.

## Spike artifacts (in the patch, under `spike/`)

- `persist.mjs` — open/persist/type-parsing probe.
- `hold.mjs` — two-process data-dir probe.
- `concurrency.mjs` — nested-`getDb()` deadlock, event-loop stall, tx blocking.
- `clock.mjs` — `now()` resolution.
- `types-probe.ts` — driver type compatibility.
- `scan_tx.py` — tx/`getDb()` heuristic scan.
