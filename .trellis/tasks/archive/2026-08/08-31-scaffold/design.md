# Design — Project Scaffold and Infrastructure

Technical design for the requirements in `prd.md`. Decisions here are
engineering choices, not product choices; the ones with a real alternative are
called out as such so they can be overridden at review.

## Architecture and boundaries

The scaffold's job is not to add features — it is to make the spec's layering
mechanically real, so that the first business task copies a correct shape
instead of inventing one.

Exactly one vertical slice is built, and it exists to demonstrate all three
layers plus the error and logging boundary:

```
GET /api/health
  src/app/api/health/route.ts      transport: no logic, wrapped in withErrorHandling
    → src/server/services/health.service.ts   domain: no Next.js in the signature
      → src/server/db/client.ts               data: the Drizzle connection
```

This slice is the reference implementation for
`spec/backend/directory-structure.md`. It deliberately contains no business
rule, so nothing here has to be unwound by a later task.

### Infrastructure modules that must exist before any business code

These are the enabling halves of prohibitions the spec already imposes. Without
them, the first business task either violates the spec or invents a private
version of each.

| Module | Why it cannot wait |
|---|---|
| `src/server/logger.ts` | pino instance with `redact` for `authorization`, `cookie`, `apiKey`, `set-cookie`. `console.log` is forbidden in `src/server/**`; the replacement must exist first. |
| `src/server/errors.ts` | `AppError` with `code` / `status` / `message` / `details`, plus the `AppErrorCode` union. Services throw typed errors from day one. |
| `src/app/api/_lib/with-error-handling.ts` | The single translation wrapper. The spec forbids per-handler try/catch, so the shared wrapper is a precondition for the first handler. |
| `src/server/env.ts` | Zod-parsed `process.env`, `server-only`. Fails fast at boot with a readable message instead of surfacing as `undefined` inside a connection string. |

`withErrorHandling` maps `ZodError` to `VALIDATION_FAILED` with flattened field
errors, `AppError` to its own status, and anything else to `INTERNAL` with a
correlation id that is logged alongside the real error and returned to the
client in place of the stack.

## The first migration

**Decision: the first migration creates `app_settings`.**

R1 requires a real migration, which raises the question of what a scaffold can
honestly create. Inventing a table for the health check to query would be fake
schema, and every genuinely useful phase-1 table is owned by a sibling task —
users by `auth-users`, provider configs by `providers`, topics and messages by
`assistants-topics`.

### Why a real migration is not optional here

The load-bearing reason is R6, not `db:generate`. drizzle-kit's generate step is
mature enough that exercising it proves little. The container migration path is
the opposite: it is this task's own deliverable and it is invisible when the
migrations directory is empty.

S8 has the production image apply pending migrations at startup, via a bundled
`migrate.mjs` plus a copied migrations directory plus an entrypoint ordering.
With zero migration files, `migrate()` returns success immediately — so whether
the bundle is correct, whether the directory made it into the runner image, and
whether the entrypoint sequence works are all unverified while the logs look
green. The failure would surface in `auth-users`, whose author is occupied with
Better Auth and would be debugging someone else's infrastructure.

A deliverable of this task cannot have its verification delegated to the next
task. That requires at least one real migration file.

### Why this table

`app_settings` is an instance-level settings table. D5 requires an "allow
registration" toggle that is neither per-user nor per-provider, so no sibling
task owns it, and both `auth-users` (reads it) and the admin surface (writes it)
depend on it existing.

Its shape involves no guesswork: `allow_registration`'s semantics and its
default of `false` come straight from D5, and the remaining columns are what the
schema conventions mandate. It doubles as the worked example of every convention
at once — text primary key holding an application-generated UUIDv7, `timestamptz`
columns, `snake_case` table exported as a `camelCase` plural, `created_at` /
`updated_at` — which later tasks copy from a real file rather than re-deriving
from the spec.

The asymmetry decided this: guessing the shape wrong costs one add-column
migration in `auth-users`, which the spec explicitly permits and which is nearly
free. Leaving the container migration path unverified costs an infrastructure
bug buried inside another task.

### Ownership and the single-row constraint

The scaffold creates the table and seeds its one row. It does **not** implement
the registration logic or any read/write path for the flag; that stays with
`auth-users`, which also owns every later column this table grows.

The single-row property is the table's one real design cost. Rather than a
CHECK constraint or a partial unique index fighting the UUIDv7 primary key, the
migration seeds one row with a hardcoded UUIDv7 literal and the service layer
reads that row. A build-time literal is still a valid UUIDv7, so this does not
contradict the application-generated rule for runtime inserts.

### Health check semantics

The endpoint issues `select 1` — liveness of the connection, cheap enough to
poll. Proof that the *migration* applied is asserted in the integration test
instead, which checks that `app_settings` exists with its default row. Keeping
these separate stops the health endpoint from becoming a schema assertion that
fails during a deploy's migration window.

A database that is down produces a handled `INTERNAL` response through the
normal error boundary, not an unhandled throw.

## Test harness

Vitest 4 `projects`, three of them. `prd.md` R7 describes "unit and
integration"; the unit half needs two environments because Node and jsdom
cannot share one:

| Project | Environment | Covers |
|---|---|---|
| `unit-node` | node | `src/server/**`, `src/lib/**` |
| `unit-dom` | jsdom + Testing Library | `src/components/**`, `src/hooks/**`, `src/stores/**` |
| `integration` | node, real database | `src/**/*.integration.test.ts` |

The integration project points at a second database, `pika_chat_test`, on the
same compose Postgres instance. It is created by a
`docker-entrypoint-initdb.d/` SQL script so a fresh `docker compose up` yields
both databases with no extra step. A `globalSetup` applies migrations to it
before the suite runs.

The suite must **fail** when the database is unreachable, never skip. A harness
that silently skips is worse than no harness: the ownership-isolation tests the
spec mandates for later tasks would appear green while proving nothing.

## Containers

Two compose files, per R6:

- `docker-compose.yml` — Postgres only, for local development against
  `pnpm dev`.
- `docker-compose.prod.yml` — app image plus Postgres, for self-hosters.

The `Dockerfile` is multi-stage: dependency install, build, then a slim runner
carrying Next.js `output: "standalone"`, running as a non-root user.

**The migrate-on-boot pitfall.** The standalone runner image contains neither
pnpm nor drizzle-kit, so `pnpm db:migrate` cannot be the container's entrypoint
step. The build stage bundles a small `scripts/migrate.ts` — which calls
drizzle-orm's `migrate()` against the committed SQL files — into a single
`migrate.mjs`, and copies it plus the migrations directory into the runner. The
entrypoint runs `node migrate.mjs && node server.js`.

This is the specific thing R6 exists to discover now rather than at release.

## Contracts this task freezes

Later tasks depend on these being stable, so changing them afterwards is a
cross-cutting edit rather than a local one:

- The error response body: `{ "error": { code, message, details? } }`.
- `AppErrorCode` as the client-facing branch key.
- Service signatures taking `(input, actor)` and never a `NextRequest`.
- Package scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`,
  `db:generate`, `db:migrate`.
- `.env` variable names.

## Trade-offs

**Exact version pins over ranges.** The matrix in `prd.md` is pinned exactly,
not with carets. A self-hosted product's reproducibility is worth more than
automatic patch uptake, and the `ai` / `@ai-sdk/*` offset makes range
resolution actively dangerous here.

**One Postgres instance for dev and test over testcontainers.** Already decided
in brainstorm. Faster and needs no Docker socket access from the test runner;
the cost is that the two databases share a server, so a test that somehow
connects to the dev database can dirty it. Mitigated by the test URL living in
its own environment variable with a distinct database name.

**Node 22 LTS.** Next 16 requires 20.9+; 22 is the current LTS line and is
pinned via `engines` and the runner image tag so the local and container
runtimes agree.

## Operational notes and rollback

There is no deployed instance and no existing data, so nothing here is
destructive and rollback is `git revert` of the task's commits.

The one irreversible operational fact this task introduces is documentation,
not code: `.env.example` must state that losing the credential encryption
secret permanently orphans every stored provider key. The `providers` task
implements the encryption; the warning has to reach the operator before they
generate the secret casually.

Migration 0000 becomes the baseline every future migration builds on. If the
`app_settings` decision is reversed after it lands, that is a new migration,
not an edit to the applied one.
