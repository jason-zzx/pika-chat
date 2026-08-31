# Project Scaffold and Infrastructure

## Goal

Turn the empty repository into a runnable Next.js 16 + TypeScript + Tailwind 4 +
shadcn/ui + Drizzle/PostgreSQL project whose structure, tooling, and commands
match `.trellis/spec/` exactly, with the database path proven end to end.

Value: every subsequent phase-1 task (`auth-users`, `app-shell`, `providers`,
`assistants-topics`, `chat-streaming`) starts from a tree the spec already
describes, and `trellis-check` gets real `pnpm lint` / `pnpm typecheck` /
`pnpm test` commands to run instead of aspirational ones.

## Background

The repository contains **no application code** — 191 tracked files, all Trellis
metadata, across three commits on a local-only `main` with no git remote.

The spec under `.trellis/spec/` was written greenfield, ahead of the code, as
binding conventions. Both spec index files state that the scaffold is expected
to match the spec, not the reverse, and carry a follow-up obligation: after this
task lands, re-read both indexes against the real tree and correct anything the
implementation legitimately diverged on.

Source of the stack decisions:
`.trellis/tasks/00-bootstrap-guidelines/research/tech-stack-decision.md`.

## Confirmed Facts

Decided elsewhere; inputs to this task, not open questions.

### Stack and pinned versions

Version matrix verified against npm on 2026-08-31:

| Package | Version |
|---|---|
| `next` | 16.3.3 |
| `react` | 19.2.8 |
| `tailwindcss` | 4.3.3 |
| `drizzle-orm` | 0.45.2 |
| `drizzle-kit` | 0.31.10 |
| `ai` | 7.0.85 |
| `@ai-sdk/react` | 4.0.88 |
| `better-auth` | 1.7.2 |
| `zustand` | 5.0.15 |
| `zod` | 4.5.4 |
| `vitest` | 4.1.11 |

Naming trap: `ai@7` pairs with `@ai-sdk/react@4` and `@ai-sdk/<provider>@4`.
Never resolve these by matching major numbers.

Package manager is pnpm (D7). Server state is TanStack Query 5, client state is
Zustand 5 (`spec/frontend/index.md`). The research record's D1 predates the
TanStack Query decision — the spec is authoritative.

### Directory layout

`spec/backend/directory-structure.md` and `spec/frontend/directory-structure.md`
specify the tree exactly: `src/app/{(auth),(app),admin,api}`,
`src/server/{services,db/{schema,migrations},auth,ai,logger.ts}`,
`src/components/{ui,layout,chat,assistant,topic,provider,common}`,
`src/{hooks,stores,lib/{api,schemas},types}`. Every module under `src/server/`
starts with `import "server-only"`.

### Command contract

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate`, `pnpm db:migrate`
are referenced by name in the spec and must exist as package scripts.

### Tooling configuration

- TypeScript `strict: true` **and** `noUncheckedIndexedAccess: true`.
- ESLint includes `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y`.
- Tailwind 4: configuration lives in `src/app/globals.css`, not
  `tailwind.config.js`.
- PostgreSQL only; no SQLite path, no dual-dialect abstraction.
- Deployment shape is Docker Compose: app container plus `postgres` container.

### Database conventions the scaffold must encode

Text primary keys holding application-generated UUIDv7, `timestamp with time
zone` throughout, `snake_case` plural tables exported as `camelCase` plurals,
PostgreSQL enums via `pgEnum`, one schema file per domain re-exported from
`schema/index.ts`, drizzle-kit migrations committed to the repo and applying
cleanly from an empty database.

## Requirements

### R1 — Runnable skeleton with a verified database round trip

The scaffold is done when the project runs **and** the Drizzle/PostgreSQL path
is proven, not merely configured: a database client, a first drizzle-kit
migration, and one endpoint performing a real query against the running
container.

Rationale: the spec requires every migration to apply cleanly from an empty
database and references `db:generate` / `db:migrate` as existing commands. A
scaffold that declares those scripts without ever running them leaves the
contract unverified and hands the first real database debugging session to
`auth-users`, which would then be debugging Better Auth and the database
connection simultaneously.

### R2 — Dependencies installed at the pinned versions

`package.json` pins the versions in the matrix above. The `ai` / `@ai-sdk/*`
offset is respected. pnpm is the package manager, with a committed lockfile.

### R3 — Directory tree materialized to match the spec

Both spec trees exist on disk. Directories that hold no code yet are not
fabricated with placeholder modules; they are created only where this task
legitimately puts a file, and the spec remains the map for the rest. Every
`src/server/` module carries `import "server-only"`.

### R4 — Tooling configured to the spec's strictness

TypeScript strict plus `noUncheckedIndexedAccess`; ESLint with the react-hooks
and jsx-a11y plugins active; Tailwind 4 configured in `globals.css`; shadcn/ui
initialized so `components/ui/` is generated territory from the first component
onward.

### R5 — Database layer wired

Drizzle client, `schema/index.ts` re-export barrel, `drizzle.config.ts`, the
first generated migration committed, and `db:generate` / `db:migrate` scripts
that actually work against the compose Postgres.

The first migration creates and seeds `app_settings`, an instance-level settings
table carrying D5's `allow_registration` flag. This task only makes the table
exist; the flag's read/write path and every later column belong to `auth-users`.
`design.md` records why a real migration is required rather than deferred — in
short, R6's migrate-on-boot path is unverifiable against an empty migrations
directory.

### R6 — Docker Compose in two shapes

A development compose file running Postgres only (the app runs locally via
`pnpm dev`), plus a multi-stage `Dockerfile` producing a Next.js standalone
image and a full-stack compose file for self-hosters that applies pending
migrations on startup.

Rationale: self-hosting is the product's core positioning and D3 treats
`docker compose up` as a hard constraint. The standalone-output and
migrate-on-boot pitfalls are cheaper to hit now than at release.

### R7 — Test harness with a real database

Vitest split into unit and integration projects. The integration project targets
a separate test database on the same compose Postgres instance and applies
migrations during setup. R1's database round trip is fixed in place by an
integration test, not by a one-off manual check. The unit half needs both a node
and a jsdom environment — see `design.md` for the project split.

The integration suite fails when the database is unreachable; it never skips.

Rationale: `spec/backend/quality-guidelines.md` forbids mocking the thing under
test and requires real-database integration tests; the ownership-isolation and
authorization tests it mandates for later tasks need this harness to exist.

### R8 — Environment configuration documented

A committed `.env.example` covering at minimum the database URL, the credential
encryption secret required by `spec/backend/database-guidelines.md`, and the
auth secret placeholder. The operator-facing consequence that losing the
encryption secret permanently orphans every stored credential is stated where a
self-hoster will read it.

### R9 — Spec reconciliation after landing

Re-read `spec/backend/index.md` and `spec/frontend/index.md` against the real
tree and correct anything the implementation legitimately diverged on. This
discharges the follow-up obligation both index files declare and that
`00-bootstrap-guidelines` explicitly refused to archive away.

## Acceptance Criteria

- [x] From a clean clone: `pnpm install`, `docker compose up -d`, `pnpm
      db:migrate`, `pnpm dev` yields a served page with no errors in the console
      or the terminal.
- [x] `pnpm lint`, `pnpm typecheck`, and `pnpm test` each exit zero, and none of
      them is vacuous — lint covers `src/`, typecheck covers the project, and
      the test run executes at least one unit and one integration test.
- [x] `GET /api/health` returns a success payload reflecting a real query
      executed against PostgreSQL; stopping the database container makes it
      report failure rather than throwing an unhandled error.
- [x] Applying migrations against a freshly created empty database succeeds with
      no manual step.
- [x] `docker build` produces an image that starts, applies pending migrations,
      and serves the same page as `pnpm dev`.
- [x] Directory tree matches both spec `directory-structure.md` documents; every
      file under `src/server/` begins with `import "server-only"` (schema files
      excepted — see spec).
- [x] An integration test connects to the real test database and passes; it fails
      if the database is unreachable rather than silently skipping.
- [x] `.env.example` is committed, and copying it to `.env` is sufficient to run
      the development stack.
- [x] Both spec index files have been re-read against the real tree, with any
      legitimate divergence corrected in the spec (R9).

## Out of Scope

- **CI workflow.** There is no git remote, so a GitHub Actions workflow has
  nowhere to run. Revisit as its own task when a remote exists.
- **Better Auth wiring, login page, seeded admin account** — `auth-users`, which
  also owns the registration-toggle logic and any further `app_settings` columns.
- **Responsive AppShell** — `app-shell`.
- **Provider CRUD, model catalog, credential encryption implementation** —
  `providers`. R8 only documents the secret; it does not implement encryption.
- **Playwright / E2E suite** — deferred past phase 1 by
  `spec/backend/quality-guidelines.md`.
- **Per-user token usage accounting** — deferred by D5.
