# SQLite benchmark and driver findings (2026-11-20)

Throwaway scripts were run under `node:sqlite` on Node 24.22.3 with SQLite 3.54.1. Electron 45 bundles the same
SQLite version, and better-sqlite3 runs the same engine. The scripts were deleted afterwards; this note records only
the setup and the numbers.

## Dataset

- 400 topics × 50 messages = 20,000 `chat_messages`; each message's `parts` is about 6 KB of JSON (CJK and Latin
  text). Every 10th message also has `{type:"file", url:"/api/files/f<n>"}`, giving 2,000 file references.
- Database file 124 MB; `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`.
- The messages are spread over 4 owners.

## Numbers (mean of 5–20 runs, after one warm-up)

| Operation | Time |
|---|---|
| Single-row write transaction (`BEGIN IMMEDIATE` … `COMMIT`) | **4.5 µs** each (1,000 took 4.5 ms in total) |
| Checkpoint write: about 100 KB `parts` UPDATE + commit | 0.09 ms (0.146 ms with the refs trigger below) |
| Delete a topic with 50 messages (FK cascade + commit) | 0.12 ms |
| Delete-topic prep: read every `parts` and `JSON.parse` (current approach) | 0.72 ms |
| Delete-topic prep: extract file ids in SQL via `json_each` | 0.17 ms |
| Search: `json_each` + `LIKE … ESCAPE` over one owner's 5k messages (no hit, so a full scan) | 22 ms |
| `isFileReferenced`: `json_each` scan over all 20k messages | **70–100 ms** |
| Same check, scan limited to one owner's messages (5k) | 12.8 ms |
| File-list in-use badge, 50 rows, `instr` scan per row | **213 ms** |

## Indexed reference table + triggers

```sql
create table message_file_refs(
  message_id text not null references chat_messages(id) on delete cascade,
  file_id text not null,
  primary key (message_id, file_id)
) without rowid;
create index message_file_refs_file_idx on message_file_refs(file_id);
-- AFTER INSERT and AFTER UPDATE OF parts: delete the message's refs, then
-- insert or ignore select new.id, substr(p.value->>'url', 12)
--   from json_each(new.parts) p where p.value->>'url' like '/api/files/_%'
```

| Operation | Time |
|---|---|
| Backfill over 20k messages | 103 ms |
| `isFileReferenced` | **0.002 ms** |
| Orphan sweep anti-join over one user's 750 files | **0.33 ms** |
| Delete-topic file ids via refs | 0.017 ms |

## Conclusions

- Write contention does not matter at this product's scale: one writer at a time is fine when a write takes µs.
- The real regression is the per-file reference scan. It is O(total messages) per call, and with a synchronous driver
  it blocks the Node event loop. `sweepOrphanFiles` (on every upload) runs it for each of the user's files older than
  the TTL. The indexed refs table removes the problem (user decision D5: maintain it with triggers).
- Search stays a linear scan of one user's text parts, the same as on PostgreSQL today, but now on the main thread.
  This is acceptable at the current scale; FTS5 is deferred.

## Driver findings

- drizzle-orm 0.45.x (stable `latest` is 0.45.4) ships SQLite drivers for `better-sqlite3` and `libsql` (plus bun, d1,
  expo, op-sqlite, proxy). A `node:sqlite` driver exists only in the 1.0 RC line (`rc` tag 1.0.0-rc.6).
- `drizzle-orm/better-sqlite3` `transaction(cb, { behavior })` wraps better-sqlite3's native
  `db.transaction(cb)[behavior]`, which is synchronous. better-sqlite3 throws if `cb` returns a promise.
- `drizzle-orm/libsql` `transaction()` awaits `client.transaction()` (default mode `write`, i.e. `BEGIN IMMEDIATE`).
  The local libsql client hands its connection to the transaction and opens another one for every other query. Those
  bindings are synchronous on the main thread, so a write from a second request busy-waits while the event loop holds
  the open transaction. It either stalls for `busy_timeout` or fails with `SQLITE_BUSY`: the same failure class as the
  PGlite deadlock (F1 in `11-16-native-desktop-local/research/pglite-spike.md`).
- better-sqlite3 13.2.0 requires `node >=22`. It is a V8-ABI addon, not N-API, so the desktop server (Electron 45,
  Node 24.22.3, `process.versions.modules` = 150) needs an Electron-ABI build. sharp is N-API and needs no rebuild.
- Next 16's default `serverExternalPackages` list already contains `better-sqlite3`.
