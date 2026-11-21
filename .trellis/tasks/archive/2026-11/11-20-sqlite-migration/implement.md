# Implementation plan — SQLite migration

Branch: `feat/native-apps`. Commit after eachnumbered step so every step can be rolled back on its own.

## Checklist

1. **Dependencies and config**
   - [x] Add `better-sqlite3` and `@types/better-sqlite3`; remove `@electric-sql/pglite`. `postgres` stays (importer).
   - [x] `drizzle.config.ts` → `dialect: "sqlite"`, `dbCredentials.url = DATABASE_PATH`.
   - [x] `env.ts`: require `DATABASE_PATH`; `DATABASE_URL` becomes optional (import source only); remove
     `PGLITE_DATA_DIR` and `TEST_DATABASE_URL` (design §6). Update `env.test.ts`.
   - [x] `next.config.ts`: drop `@electric-sql/pglite` from `serverExternalPackages`.
2. **Schema and baseline migration** (design §3, §5)
   - [x] Port the 10 schema files to `sqlite-core`; `columns.ts` gets the ms timestamp helper and the SQL default.
   - [x] Add `message_file_refs` to the schema.
   - [x] Delete `src/server/db/migrations/*` and `meta/`; run `pnpm db:generate` → `0000`.
   - [x] `pnpm drizzle-kit generate --custom --name message_file_refs_triggers` → write the two triggers.
3. **Client** (design §1)
   - [x] Rewrite `client.ts`: better-sqlite3 handle, pragmas, UDFs, `globalThis` cache, `closeDb`; delete
     `executeRows` and every caller of it.
   - [x] `instrumentation.ts`: boot migration for all modes; the local-mode branch keeps only admin provisioning and
     the shutdown hook.
4. **Transactions** (design §2)
   - [x] Convert the 14 transaction sites and their tx-taking helpers to synchronous callbacks with
     `{ behavior: "immediate" }`; remove the 8 `.for("update")` calls; make `insertWithShortId` synchronous.
   - Gate: `rg -n 'transaction\(async' src/server` and `rg -n '\.for\("update"\)' src/server` both return nothing.
5. **Query rewrites** (design §4)
   - [x] search, file reference/basename/extension, translation and provider-ref JSON merges, topic cursor (and its
     Zod schema), `databaseNow`, demo counters, counts/sums, `unique-violation.ts`, health, Better Auth provider.
   - Gate: `rg -n 'jsonb|ilike|::text|::int|::bigint|::date|::timestamptz|regexp_replace|pg-core|@>' src` returns
     only intentional hits (expected: none).
6. **Deletion via refs** (design §5)
   - [x] `deleteTopic` / `deleteAssistant` select file ids from `message_file_refs` inside the transaction; the in-use
     badge, `isFileReferenced` and `sweepOrphanFiles` use the refs table; delete `messageReferencesFileSql`.
7. **Tests**
   - [x] Integration setup → per-worker `:memory:` + migrate; delete `vitest.integration.pglite.ts` and the PG
     `globalSetup`; update `vitest.config.mts`.
   - [x] Adapt PG-specific tests; add the new tests from design §9.
   - Validation: `pnpm lint && pnpm typecheck && pnpm test`.
8. **Boot import** (design §7)
   - [x] `postgres_import` marker table; `src/server/db/import-postgres.ts`; wire it into `instrumentation.ts` after
     the boot migration.
   - [x] Tests: boot decision, value mapping, refusals (no PostgreSQL needed: the PG side is exercised by the manual
     check).
9. **Docker and compose** (design §6)
   - [x] Dockerfile: drop the `migrate.mjs` bundle and `scripts/migrate.ts`; `ENV DATABASE_PATH=/data/files/pika-chat.db` (design §6, no new volume); CMD;
     musl build of better-sqlite3 (add build tools only if needed).
   - [x] Compose files (`full`, `standalone`), delete `docker-compose.dev.yml` and `docker/postgres/`, `.env.example`.
   - Validation: `docker build -t pika-sqlite .` and `docker compose -f docker-compose.standalone.yml up` with
     `PIKA_IMAGE=pika-sqlite` → `/setup`, chat, upload, restart, data persists.
10. **Desktop** (design §8)
    - [x] `local-server.ts` paths/env; `build-server.mjs` Electron smoke check (no rebuild, D10); no `@electron/rebuild`
      devDependency.
    - Validation: `DOCKER_BUILD=1 pnpm build && node native/desktop/scripts/build-server.mjs && pnpm -C native/desktop start`
      on Linux → local mode boots on a clean profile, chat works, quit/relaunch keeps data.
11. **CI**
    - [x] `ci.yml`: remove the postgres service and the PGlite job. Add a `workflow_dispatch` trigger and a
      `desktop-smoke` matrix job (the same 4 OS targets as `release.yml`) gated by
      `if: github.event_name == 'workflow_dispatch'`. It runs `pnpm build` + `build-server.mjs` (smoke check)
      and publishes nothing.
    - [x] `release.yml`: replace the dummy `DATABASE_URL` build env with `DATABASE_PATH`.
    - [ ] Run `desktop-smoke` once on the branch (deferred). **Never dispatch `release.yml` from a branch**: its Docker job pushes
      unconditionally and tags `latest` for ref names without `-`, and `create-release` would publish a GitHub
      Release named after the branch.
    - [x] Check that the Docker dry-run build covers `linux/arm64` (musl better-sqlite3 binary); if it is amd64-only,
      run one local `docker buildx build --platform linux/arm64` instead of changing CI.
12. **Docs and specs** (design §10): specs, both READMEs (deploy, backup, upgrade-from-PG steps). CHANGELOGs untouched (D11).

## Manual end-to-end checks (deferred)

- [ ] Upgrade import: with the v0.4.2 `docker-compose.full.yml`, run the **v0.4.2** image and create data (2 users, a
  provider, assistants, topics with attachments and generated images, a favorite, translations, a compressed topic,
  2FA on one user). Then change only the image tag to the new build, run `docker compose up -d`, and check the
  following on the result:
  - logins (password and 2FA) work;
  - the sidebar order and pagination match;
  - attachments open, and the in-use badges match;
  - search hits match;
  - deleting a topic reclaims its files.
- Restart: the logs show no second import. Stop the postgres service: the app still boots and logs that
  `DATABASE_URL` is ignored.

## Review gates

- After step 4: a `trellis-check` pass on the transaction conversion (the highest-risk semantic change).
- After step 7: the full test suite is green before touching Docker, desktop or docs.

## Rollback points

- Steps 1–7 are code-only and revertable per commit.
- The importer never writes to PG, and the desktop leaves `<userData>/local/db/` untouched, so rolling back a release
  means going back to the previous image or installer.
