# Design — SQLite migration

Evidence: `research/sqlite-benchmark.md`; prior art `11-16-native-desktop-local/research/pglite-spike.md`.

## 1. Driver and connection

- **better-sqlite3 13.x via `drizzle-orm/better-sqlite3`** (drizzle stays on 0.45.x).
  - Rejected `libsql`: its async interactive transaction opens a second same-thread connection, and other writes
    busy-wait on the main thread (research §Driver findings).
  - Rejected `node:sqlite`: drizzle supports it only in the 1.0 RC; upgrading the ORM to an RC is out of scope.
- `src/server/db/client.ts` opens **one connection per process** at `DATABASE_PATH`, creating the parent directory.
  It sets `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON` and `busy_timeout = 5000`, and registers
  the UDFs from §4. The connection is cached on `globalThis` (same reason as today: HMR and `vi.resetModules` must not
  open a second handle).
- `closeDb()` closes the handle; local-mode shutdown keeps calling it. `executeRows()` is deleted: better-sqlite3
  drizzle uses `db.all/get/run(sql)` instead of `execute`.
- Types: `DbClient = BetterSQLite3Database<typeof schema>`; `DbTransaction` is derived from its `transaction`
  callback. Services stop importing `pg-core` types.

## 2. Transactions — the event loop is the lock

- Every `db.transaction` callback becomes **synchronous**: `db.transaction((tx) => { … }, { behavior: "immediate" })`,
  with `.all() / .get() / .run()` used inside. On a single connection, no other query can run while a synchronous
  callback is executing, so:
  - all 8 `.for("update")` row locks are removed (`topic.service.ts:178`, `generation.service.ts:435,493,809,835`,
    `generation-target.service.ts:80,108`, `assistant.service.ts:270`). The invariants they guarded still hold
    because whole transactions are serialized: one active generation per topic, exclusive claims, delete-vs-finalize
    ordering;
  - the PGlite rule "never call `getDb()` inside a transaction" disappears. It is the same connection, so it cannot
    deadlock. Threading `tx` stays the convention;
  - network I/O inside a transaction becomes structurally impossible, because the callback cannot `await`.
- `immediate` takes the write lock at `BEGIN`, so another process (the sqlite3 CLI, a backup) gets `SQLITE_BUSY`
  handling via `busy_timeout`, never a lock upgrade failure in the middle of a transaction.
- Conversion surface: 14 transaction sites and the ~18 helpers they call that take `tx` or an `executor`
  (`message.service.ts`, `generation.service.ts:612`, `generation-target.service.ts:38,72,93`,
  `demo-usage.service.ts:28,52`, `topic.service.ts:265`). A helper called inside a transaction becomes synchronous.
  Callers outside a transaction may still `await` it, since awaiting a value is fine.
- `insertWithShortId` (`short-id-insert.ts`) is used inside a transaction (`generation.service.ts:408`), so it becomes
  synchronous for all 4 callers (`insert: (id) => …returning().get()`).
- Reads outside transactions keep `await db.select()…`, because drizzle's SQLite builders are thenables in sync mode.

## 3. Schema mapping (`sqlite-core`)

| PostgreSQL | SQLite |
|---|---|
| `pgTable` | `sqliteTable`, same table and column names |
| `timestamptz` (`columns.ts`) and the 2 inline `timestamp(... withTimezone)` (`app-settings.ts:19,22`) | `integer({ mode: "timestamp_ms" })`; `.defaultNow()` becomes the DB default `(cast(unixepoch('subsec') * 1000 as integer))` through the shared `columns.ts` helper |
| `boolean` | `integer({ mode: "boolean" })` |
| `jsonb` (9 columns) and `'{}'::jsonb` / `'["text"]'::jsonb` / `'[]'::jsonb` defaults | `text({ mode: "json" }).$type<…>()`; defaults `'{}'` / `'["text"]'` / `'[]'` |
| `pgEnum` (13) | `text({ enum: VALUES })`; the value tuples are exported for TS types. No DB CHECK: values are already validated at the boundary |
| `bigint({ mode: "number" })` (`auth.ts:27`, `app-settings.ts:16`) | `integer()` |
| `date({ mode: "string" })` (`demo.ts:7`) | `text()`, holding `YYYY-MM-DD` |
| Partial unique indexes (`chat.ts:73-75,185-191`) | Same `.where(...)` (SQLite supports partial indexes) |
| `topics_assistant_list_idx` `DESC NULLS FIRST` (`assistant.ts:52-57`) | `.desc()` without `nullsFirst()`. SQLite has no NULLS clause on index columns, and these columns are NOT NULL |

- **Migrations**: the 30 PG migrations and their `meta/` are deleted (git history keeps them). drizzle-kit
  (`dialect: "sqlite"`, `dbCredentials.url = DATABASE_PATH`) generates a fresh `0000` baseline. A second migration,
  `0001`, is generated with `drizzle-kit generate --custom` and holds the triggers from §5.
- The **boot migration runs in every mode** (`instrumentation.ts`, `drizzle-orm/better-sqlite3/migrator`, synchronous,
  before `startGenerationRunner`). `scripts/migrate.ts`, `migrate.mjs` and the `node migrate.mjs &&` in the Dockerfile
  CMD are removed.

## 4. Query rewrites

| Site | Now (PG) | SQLite |
|---|---|---|
| `search.service.ts:46` titles | `ilike(title, pattern)` | `` sql`${title} like ${pattern} escape '\'` `` |
| `search.service.ts:71-74` messages | `jsonb_array_elements` + `->>` + `ilike` | `exists (select 1 from json_each(parts) p where p.value->>'type' = 'text' and p.value->>'text' like ? escape '\')` |
| `file.service.ts:633-652,757,797,887` reference predicate | `parts @> jsonb_build_array(jsonb_build_object('url', …))`, a scan per file | `exists (select 1 from message_file_refs r where r.file_id = files.id)` (§5); `messageReferencesFileSql` is deleted |
| `file.service.ts:662-676` basename/extension | `regexp_replace` / `strpos` | Deterministic UDFs `file_basename(name)` / `file_extension(name)` registered in `client.ts`, implemented by the existing `basename()` / `fileExtension()` in `src/lib/files/media-types.ts`. One implementation instead of a SQL mirror |
| `translation.service.ts:139` | `coalesce(t,'{}'::jsonb) \|\| {lang: text}` | `json_set(coalesce(t, '{}'), '$."<lang>"', ?)`, where the path is bound as a parameter |
| `provider-files.ts:224` | `refs \|\| {configId: record}` | `json_set(refs, '$."<configId>"', json(?))`. Not `json_patch`: RFC 7396 deep-merges nested objects and deletes null keys, while PG `\|\|` replaces a key's value as a whole |
| `topic.service.ts:77,84` keyset cursor | `updated_at::text` (µs) and `::timestamptz` row compare | Cursor `[String(updatedAtMs), id]`, comparison `(updated_at, id) < (?, ?)` (SQLite row values). The DB stores ms, so the cursor is exact; ties break by `id`. The cursor Zod schema requires a digit string, so old µs cursors return 400 and the client refetches page 1 |
| `generation.service.ts:118-125` `databaseNow()` | `select now()` | `new Date()`: a single process shares the clock. The `clock` injection stays for tests |
| `demo-usage.service.ts:34-40` | raw upsert with `::date` | Same `insert … on conflict(subject, day, kind) do update … returning count` with `day` as a text param |
| `assistant.service.ts:47`, `file.service.ts:768`, `quota.ts:28` | `count()::int`, `sum()::bigint` | `count(...)`, `coalesce(sum(...), 0)`; SQLite returns integers |
| `unique-violation.ts:24` | `code === "23505"` | `code === "SQLITE_CONSTRAINT_UNIQUE" \|\| "SQLITE_CONSTRAINT_PRIMARYKEY"` (the PK case keeps the short-id re-mint working) |
| `health.service.ts:11` | `db.execute(select 1)` | `db.get(sql\`select 1\`)` |
| `auth/index.ts:118` | `provider: "pg"` | `provider: "sqlite"` |

Behavior change accepted with this design: SQLite `LIKE` folds case only for ASCII. Search stays case-insensitive for
English and has no effect on CJK, but becomes case-sensitive for non-ASCII letters (`É`/`é`, Cyrillic).

## 5. Attachment references and deletion (D2, D5)

- New table `message_file_refs(message_id → chat_messages.id ON DELETE CASCADE, file_id text, PK(message_id,
  file_id)) WITHOUT ROWID`, plus an index on `file_id`. It is declared in the drizzle schema, so queries are typed.
  There is no FK to `files`: a reference is a URL in `parts`, exactly as today.
- Custom migration `0001` defines `AFTER INSERT ON chat_messages` and `AFTER UPDATE OF parts ON chat_messages`
  triggers. Each one deletes the message's refs, then runs
  `insert or ignore … select new.id, substr(p.value->>'url', length('/api/files/') + 1) from json_each(new.parts) p where p.value->>'url' like '/api/files/_%'`.
  - That is the single definition of "a message references a file". It matches any top-level part with a
    `/api/files/<id>` url, which is the same scope as today's `@>` predicate.
  - It costs about 0.06 ms extra per 100 KB checkpoint write. The 11 message write sites do not change.
- Consumers:
  - the in-use badge and `isFileReferenced`: indexed `exists` on `file_id`;
  - `sweepOrphanFiles`: anti-join;
  - `deleteTopic` / `deleteAssistant`: inside the transaction they select
    `distinct r.file_id from message_file_refs r join chat_messages m on m.id = r.message_id where m.topic_id in (…)`.
    No `parts` are read. After commit they call `deleteFilesIfUnreferenced(fileIds)` as today.
- `fileIdsFromParts` remains only where parts are already in memory (`message.service.ts:749`).
- Spec note required: the triggers live in a custom migration that drizzle-kit does not model. Editing the URL
  prefix (`FILE_URL_PREFIX`) needs a new migration that recreates the triggers.

## 6. Configuration and deployment

- Env (`env.ts`):
  - `DATABASE_PATH` is required (a file path, or `:memory:` in tests).
  - Removed: `DATABASE_URL` as an app setting, `TEST_DATABASE_URL`, `PGLITE_DATA_DIR`.
  - `LOCAL_MODE` still requires `LOCAL_ADMIN_PASSWORD`.
  - `DATABASE_URL` is optional and means only "import source" (§7). `resolveDatabaseUrl()` keeps the old resolution:
    `DATABASE_URL` wins, else a URL is assembled from `POSTGRES_HOST/PORT/USER/PASSWORD/DB` (D8). Once the import
    marker exists both are ignored, so operators never have to remove them. They are legacy-only and appear in no
    compose file, `.env.example` or README (D9).
- Docker:
  - `ENV DATABASE_PATH=/data/files/pika-chat.db` (D7) and `CMD ["node", "server.js"]`. The importer is part of the
    server (§7), so the image ships no separate script.
  - Why `/data/files`: every released compose file already mounts that volume, so an unchanged old compose file
    persists the database (and its `-wal` / `-shm` files). If the database were outside a persisted mount, a container
    recreate would lose the SQLite file while `DATABASE_URL` is still set, and the boot import would silently repeat,
    losing every write made since the first import.
  - No collision with attachments: local storage keys are always `<userId>/<fileId>[.ext]` sub-paths
    (`storageKeyFor`, `file.service.ts:92`), and the storage layer never lists the directory. A deployment using S3
    still mounts the volume in both compose files.
  - The volume now holds all instance data, so backup docs name that single volume.
  - better-sqlite3 ships `linuxmusl-x64/arm64` prebuilds and its loader uses them when no `build/Release` binary
    exists. `pnpm-workspace.yaml` sets `allowBuilds: better-sqlite3: false`, so the deps stage runs no `node-gyp`
    and installs no compiler (D10).
- Compose:
  - `full`: the `postgres` service and its volume are removed; rustfs stays.
  - `standalone`: only the app plus volumes.
  - The existing `files_prod_data:/data/files` mount stays as it is, and no new volume is added.
  - `dev`: deleted, along with `docker/postgres/init/`.
- `.env.example`, `next.config.ts` (`@electric-sql/pglite` is dropped from `serverExternalPackages`; better-sqlite3 is
  in Next's default list) and `package.json` (drop `@electric-sql/pglite`, add `better-sqlite3`; `postgres`
  stays, but only for the importer in §7) change accordingly.

## 7. Automatic PostgreSQL import at boot (D4, D6)

- `src/server/db/import-postgres.ts`, called from `instrumentation.ts` right after the boot migration and before
  `startGenerationRunner`. `postgres` (postgres-js) stays as a runtime dependency and is loaded through dynamic
  `import()` only on this path.
- Marker: table `postgres_import (id text primary key = 'singleton', imported_at, source_info json (host and database
  only, never credentials), row_counts json)` (`src/server/db/schema/postgres-import.ts`). It exists
  only in SQLite. The importer writes it in the **same SQLite transaction** as the copied rows, so the database has
  either all the data and the marker, or neither.
- Boot decision:
  1. Marker present: `DATABASE_URL` is ignored. If it is set, log once at info level that the PostgreSQL service is no
     longer used and can be removed.
  2. No marker and `DATABASE_URL` unset: this is a fresh install, no import.
  3. No marker and `DATABASE_URL` set: import. Any failure makes the boot fail with a readable error, PG stays
     untouched and SQLite is rolled back, so the next boot retries. The two expected failures are "PostgreSQL
     unreachable: keep the postgres service running for the first boot of this version" and "SQLite already holds
     data".
- Upgrade flow for operators: `docker compose pull && docker compose up -d` with the unchanged compose file and `.env`
  (the volume is covered in §6). Once the logs report the import, the postgres service can be removed at any time.
- Import steps:
  1. **Refuse** unless every app table is empty. The `app_settings` row seeded by the baseline migration does not
     count, because the source row replaces it.
  2. Connect to PG with `max: 1`. For every copied table (all SQLite tables except `postgres_import` and the derived
     `message_file_refs`), compare its column set (`pragma table_info`) with the PG `information_schema.columns`. A
     mismatch is refused with "upgrade to v0.4.2 first so PostgreSQL is on the expected schema". Both 0028 (v0.4.0 – v0.4.2)
     and 0029 qualify, because 0029 only changes an index.
  3. Set `pragma foreign_keys = off`, then run a manual `BEGIN` / `COMMIT` across the async PG reads. This is safe
     only because Next awaits `register()` before serving requests, so nothing else touches the connection during the
     import; the spec must record that constraint.
  4. Copy each table in batches of 1,000 rows. Values are mapped by runtime type: `Date` → epoch ms,
     `boolean` → 0/1, object/array → `JSON.stringify`, everything else as is. The `message_file_refs` triggers fill
     the refs as messages land.
  5. Run `pragma foreign_key_check` (must be empty), compare per-table row counts, insert the marker, `COMMIT`, then
     restore `foreign_keys = on`. Progress is logged per table, since a large database can take a while.
- The importer never writes to PG; a rollback is simply the old image plus the old compose file.
- Active generations are copied as they are, and the boot recovery marks them interrupted. Attachment bytes (disk or
  S3) do not move; storage keys stay the same.
- Timestamps lose µs precision and become ms, which is harmless (§4 cursor).
- Desktop rc.1 PGlite data is not imported (D4). The new database file is `<userData>/local/pika-chat.db`, and the old
  `<userData>/local/db/` directory is left untouched, so a downgrade to rc.1 still works.

## 8. Desktop

- `native/desktop/src/local-server.ts`:
  - `localPaths().dbFile = join(root, "pika-chat.db")`;
  - the child env passes `DATABASE_PATH` instead of `PGLITE_DATA_DIR`.
- `native/desktop/scripts/build-server.mjs`:
  - no rebuild (D10): better-sqlite3 13 is an N-API addon, and the bundled prebuild for the host OS/arch loads in
    Electron as-is. The release matrix builds natively on each OS/arch, so each installer carries its own prebuild;
  - a smoke check runs `ELECTRON_RUN_AS_NODE=1 electron -e` to require every bundled `better-sqlite3` copy, open
    `:memory:` and query `sqlite_version()`. A failure fails the build.

## 9. Tests and CI

- The integration setup migrates a fresh `:memory:` database per test worker (the pattern of
  `vitest.integration.pglite.ts`). The PG `globalSetup` and `TEST_DATABASE_URL` are removed.
- Tests that encode PG specifics change with the code:
  - the µs pagination test becomes "same-ms rows ordered and paged by id";
  - row-lock tests (`generation-runner.integration.test.ts`) assert the same invariants without PG locks.
- New tests:
  - refs trigger: insert, update that adds or removes a file part, cascade on message, topic and assistant delete,
    and non-`/api/files` urls being ignored;
  - delete-topic / delete-assistant still reclaim their files;
  - JSON merge semantics for translations and provider refs;
  - search `%` / `_` literals with `ESCAPE`;
  - importer unit tests for value mapping, the boot decision (marker present / fresh install / import) and the
    "target not empty" / "column mismatch" refusals;
  - query-plan assertions: `EXPLAIN QUERY PLAN` for the in-use badge, `isFileReferenced`, the orphan sweep and the
    delete-path file-id query must use `message_file_refs` indexes and contain no `SCAN chat_messages`. This verifies
    the structural fix deterministically on a tiny dataset, with no timing thresholds; the timing evidence is
    `research/sqlite-benchmark.md`.
- The importer's end-to-end run against a real PG is a **manual** check (implement.md), so CI carries no PG.
- `ci.yml`: the `postgres` service and the PGlite job are removed. A new `desktop-smoke` matrix job (4 OS targets)
  runs only on `workflow_dispatch`. It does `pnpm build` + `build-server.mjs`, publishes nothing, and is the way to
  check the Electron better-sqlite3 build before tagging. `release.yml` runs the same smoke check inside
  `build-server.mjs` on every release. Do not dispatch `release.yml` from a branch: its Docker job pushes and can tag
  `latest`.
- Not in CI by design: the upgrade import from a real v0.4.2 PostgreSQL. It is a one-time path that needs the old image,
  a PG service and real data, so it is covered by the manual check in `implement.md`.

## 10. Docs and specs

- Specs:
  - `backend/database-guidelines.md`: Engine, timestamp and enum rules, the Transactions section rewritten for
    synchronous transactions, Forbidden list;
  - `backend/local-mode.md`;
  - `backend/topic-list-pagination.md`: cursor;
  - `backend/search.md`: `LIKE ESCAPE`, ASCII-only case folding;
  - `backend/chat-attachments.md`: refs table and trigger;
  - `backend/chat-generation-lifecycle.md`: lock wording;
  - `backend/demo-mode.md`: counters;
  - `backend/index.md`: stack table.
- `README.md` / `README.zh-CN.md`: deployment, backup (the single `/data/files` volume: copy it while the server is
  stopped, or use `sqlite3 .backup` for the db file) and the upgrade-from-PostgreSQL steps.
- `CHANGELOG.md` / `CHANGELOG.zh-CN.md`: not touched in this task (D11). The release entry must later carry the
  operator notes: keep PostgreSQL running with its existing settings for the first boot, remove it afterwards,
  desktop local data starts fresh, search case folding is ASCII-only.

## 11. Risks and deferred

- Search remains a linear scan of the user's text parts, about 22 ms per 5k messages, and blocks the main thread.
  **FTS5 is deferred.**
- Any large synchronous read blocks the event loop. The known heavy paths (reference scans) are fixed by §5; others
  are measured in the manual check.
- better-sqlite3 needs native binaries for musl (Docker) and the Electron ABI on 4 desktop targets. This is verified
  per target in the implementation checklist.
- Not supported: multiple server processes on one database file (already the case: the runner is single-process).
