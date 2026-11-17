# Local-mode embedded DB

## Repo evidence
- Driver coupling is small: only `src/server/db/client.ts` imports `drizzle-orm/postgres-js` + `postgres`;
  one raw `db.execute(sql\`select 1\`)` in `src/server/services/health.service.ts:9`.
- Driver-specific comments: `generation.service.ts:123` (raw column value parsing),
  `files/quota.ts:22` (bigint SUM handling) — re-verify under the new driver.
- SQL features: `ilike`, jsonb `->>`, `SELECT ... FOR UPDATE` (topic, setup, assistant,
  generation, generation-target services). No extensions, tsvector, advisory locks, LISTEN/NOTIFY.
- Migrations: `scripts/migrate.ts` (postgres-js migrator) bundled with esbuild in Dockerfile and run
  before `server.js`. 29 SQL migrations in `src/server/db/migrations`.

## Options
- **PGlite** (`@electric-sql/pglite`, `drizzle-orm/pglite`, `drizzle-orm/pglite/migrator`):
  Postgres compiled to WASM, in-process, persisted to a data dir. ~3MB wasm; no extra binaries per platform.
  Risk: single connection — PGlite serializes queries and `transaction()` holds an exclusive lock.
  Code that calls `getDb()` (not `tx`) while a transaction is open would deadlock;
  concurrent generation tasks serialize. `FOR UPDATE` is accepted (no-op contention).
- **embedded-postgres**: real Postgres binaries per OS/arch spawned as a child process (+30–50MB per
  platform), full compatibility, postgres-js driver unchanged.

## Decision
Start with PGlite; gate with a spike that runs the existing integration tests against PGlite.
If deadlocks / incompatibilities surface that need non-trivial refactors, fall back to embedded-postgres
(driver unchanged, only packaging cost).
