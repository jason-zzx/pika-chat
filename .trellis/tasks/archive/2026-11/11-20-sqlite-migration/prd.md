# Migrate database from PostgreSQL/PGlite to SQLite

## Goal

Every Pika Chat deployment, the Docker server and desktop local mode alike, runs on one embedded SQLite database.
The project gets a single SQL dialect, no database container, native (non-WASM) speed and file-level backups.
Deleting a topic or assistant stops loading full message `parts` inside the write transaction, and attachment
reference checks stop scanning every message.

## Decisions (user)

| ID | Decision |
|---|---|
| D1 | Both the server and desktop local mode move to SQLite. PostgreSQL and PGlite stop being supported runtime databases (2026-11-20). |
| D2 | Delete-topic and delete-assistant get attachment file ids from SQL inside the transaction instead of reading every message's `parts` into JS. Done in this migration, not deferred. |
| D3 | No soft delete. Deletion stays immediate. |
| D4 | Existing PostgreSQL server data is carried over. Desktop rc.1 PGlite local data is **not** migrated: local users start fresh, announced in the release notes. |
| D5 | Attachment references move to an indexed `message_file_refs` table maintained by SQLite triggers on `chat_messages` (benchmark: `research/sqlite-benchmark.md`). |
| D6 | The import runs automatically at boot when `DATABASE_URL` is set, and records a marker in SQLite. After that, `DATABASE_URL` is ignored: operators neither delete it nor see a boot refusal because of it. |
| D8 | The boot import also accepts the discrete `POSTGRES_*` variables that PostgreSQL-based releases accepted (same resolution as before: `DATABASE_URL` wins), so non-compose upgrades need no config change either (2026-11-21). |
| D9 | Obsolete database variables (`DATABASE_URL`, `POSTGRES_*`) are not written into compose files, `.env.example` or the README; only the code and specs know about them. |
| D10 | No Electron rebuild of better-sqlite3: it is an N-API addon with bundled prebuilds for every target, so installs skip its build script (`allowBuilds: false`), Docker needs no compiler, and only the Electron smoke check stays. |
| D11 | CHANGELOG entries are not written in this task; they are written at release time. |
| D7 | The Docker SQLite file defaults to `/data/files/pika-chat.db`, inside the volume every released compose file already mounts. Unchanged old compose files persist it, and one volume holds all instance data. |

## Background (confirmed facts)

- The driver switch lives only in `src/server/db/client.ts`. Services are typed against `PgDatabase`.
- PG-specific surface:
  - 10 `pg-core` schema files;
  - 30 PG migrations;
  - 8 `.for("update")` locks;
  - 14 transactions, all of which contain only DB statements;
  - raw SQL in search, file references, JSON merges, the topic cursor, `databaseNow`, demo counters and unique-violation
    detection.

  Full inventory with file:line anchors is in `design.md` §2–§4.
- `sweepOrphanFiles` runs on every upload and checks each of the user's files older than the TTL with a predicate
  that scans all messages (`file.service.ts:633-652,872-890`). On a synchronous SQLite driver, that scan blocks the
  server: 70–100 ms per check at 20k messages.
- Released data: Docker images up to v0.4.2 (Latest) and v1.0.0-rc.1 store data in PostgreSQL. The v0.4.2 / rc.1 schema is
  migration `0028`; `0029` (unreleased) only changes an index. Desktop v1.0.0-rc.1 (released 2026-11-20) stores
  local data in PGlite under `<userData>/local/db`.
- Mobile (Capacitor) is remote-only and is unaffected.

## Requirements

- **R1** One SQLite schema and one fresh migration baseline drive the server, desktop local mode and tests. Migrations
  run automatically at boot in every mode.
- **R2** Every PG-specific query has a SQLite equivalent with the same observable behavior:
  - search scope and literal `%` / `_` handling;
  - pagination with no skipped or duplicated rows;
  - shallow JSON-merge semantics for translations and provider file references;
  - quotas, counts and demo counters;
  - short-id re-mint on collision.

  One accepted exception: case-insensitive search matching covers ASCII letters only.
- **R3** The guarantees currently provided by row locks still hold: a single active generation per topic, claim
  exclusivity, and delete-vs-finalize ordering.
- **R4** (D2, D5) A message's file references are kept in `message_file_refs` by DB triggers. The in-use badge,
  `isFileReferenced`, the orphan sweep and delete-topic / delete-assistant all read that table; none of them reads
  `parts` to find references.
- **R5** (D7) Docker deployment needs no database container. `DATABASE_PATH` defaults to `/data/files/pika-chat.db`
  on the already-mounted files volume, and the compose files gain no new volume.
- **R6** (D10) Desktop local mode uses the same SQLite path at `<userData>/local/pika-chat.db`; better-sqlite3's
  bundled N-API prebuild loads under Electron on Windows, macOS (Intel and Apple Silicon) and Linux, proven by the
  build-time smoke check. The old `<userData>/local/db/` stays
  untouched.
- **R7** (D4, D6, D8) On boot, if a previous PostgreSQL connection is configured (`DATABASE_URL`, else `POSTGRES_*`)
  and SQLite has no import marker, the server copies the PostgreSQL database (v0.4.0 – v0.4.2 schema, shared by v1.0.0-rc.1; older
  sources are refused with "upgrade to v0.4.2 first") into SQLite before serving:
  - it refuses a non-empty target or a mismatched source schema;
  - it verifies foreign keys and per-table row counts;
  - it never writes to PostgreSQL.
  - The marker is written in the same transaction as the data. A failed import fails the boot with a readable error
    and leaves SQLite empty, so the next boot retries.
  - With the marker present, the PostgreSQL settings are ignored.
  - Upgrading takes `docker compose pull && docker compose up -d` with the unchanged compose file and `.env`.
- **R8** (D9, D11) Specs, both READMEs (deploy, backup, upgrade-from-PostgreSQL), env examples, compose files and CI
  reflect the new engine. CHANGELOGs are left untouched.

## Acceptance Criteria

- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, with the integration suite running on SQLite. CI has no
  PostgreSQL service and no PGlite job. (R1, R8)
- [x] `src/` contains no `pg-core`, `jsonb`, `ilike`, `::` casts, `regexp_replace`, `@>` or `.for("update")`, and no
  async `db.transaction` callback. (R1–R3)
- [x] The integration tests cover:
  - refs trigger: insert, update that adds or removes a file part, cascade on message, topic and assistant delete, and
    non-`/api/files` urls being ignored;
  - delete-topic and delete-assistant still reclaim their attachments;
  - search with `%` / `_` literals;
  - same-millisecond pagination ordered by id;
  - JSON merge semantics;
  - single active generation per topic (`generation.topicBusy` conflict + no-leak rollback on synchronous SQLite tx). (R2–R4)
- [x] Delete-topic and delete-assistant transactions do not select `chat_messages.parts`. (R4)
- [x] The app container alone, from `docker-compose.standalone.yml`, boots on an empty volume, completes `/setup`,
  chats, uploads files and keeps the data across restart. (R5)
- [ ] The Electron better-sqlite3 smoke check is built into `build-server.mjs`, so every release build fails before
  publishing if the module does not load. On Linux, local mode boots on a clean profile and keeps data across relaunch (verified).
  *Deferred*: run the on-demand (`workflow_dispatch`-only) `desktop-smoke` job in `ci.yml` across all four targets before release. (R6)
- [x] Automated: the boot decision (marker present → `DATABASE_URL` ignored; fresh install; import), value mapping,
  and the non-empty / schema-mismatch refusals are covered by unit and integration tests without PostgreSQL. (R7)
- [ ] One-time manual check (*deferred*): a v0.4.2 deployment (PG 17 + v0.4.2 image + data) upgraded by changing only the
  image tag imports at boot, and on the result:
  - logins work, including 2FA;
  - sidebar order and pagination match;
  - attachments open and in-use badges match;
  - search results match.

  A restart does not re-import, and stopping the postgres service afterwards does not affect boot. (R7)
- [x] An integration test asserts via `EXPLAIN QUERY PLAN` that the in-use badge, `isFileReferenced`, the orphan sweep
  and the delete-path file-id query use the `message_file_refs` indexes and never scan `chat_messages`. (R4)
- [x] The specs listed in `design.md` §10 and both READMEs are updated; compose files, `.env.example` and the
  README contain no `DATABASE_URL` / `POSTGRES_*`; both CHANGELOGs are unchanged from before the task. (R8)

## Out of Scope

- Mobile app changes.
- Soft delete or trash (D3).
- Migrating desktop rc.1 PGlite data (D4).
- Multiple server processes on one database file.
- FTS5 / indexed search (deferred: search stays a linear scan of the user's text parts).
- Upgrading drizzle-orm to the 1.0 line.
