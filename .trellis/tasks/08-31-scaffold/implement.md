# Implementation Plan — Project Scaffold and Infrastructure

Ordered so that each stage leaves the tree in a runnable, committable state.
Every stage ends with its own validation; do not batch validation to the end,
because a scaffold failure at stage 8 is very hard to attribute if stages 1
through 7 were never exercised.

Stage boundaries are the rollback points. One commit per stage.

## S1 — Project initialization

- Scaffold Next.js 16 with TypeScript, Tailwind 4, App Router, `src/` layout,
  pnpm.
- Pin `packageManager` and `engines` (Node 22 LTS).
- Replace any caret ranges the generator emits with the exact versions from the
  `prd.md` matrix. Verify `ai@7` resolved alongside `@ai-sdk/react@4` — a
  major-number match here is the documented trap.

**Watch for:** the generator's own layout choices (`app/` vs `src/app/`, a
`tailwind.config.js` that Tailwind 4 no longer wants) diverging from the spec.
The spec wins; correct the output rather than adapting the spec.

Validate: `pnpm dev` serves the default page; `pnpm build` succeeds.

## S2 — Tooling strictness

- `tsconfig.json`: `strict: true` **and** `noUncheckedIndexedAccess: true`.
- ESLint flat config with `eslint-plugin-react-hooks` and
  `eslint-plugin-jsx-a11y` active, merged with the Next config rather than
  replacing it.
- Add scripts: `lint`, `typecheck`, `test`, `db:generate`, `db:migrate`.

Validate: `pnpm lint` and `pnpm typecheck` both exit zero. Confirm the a11y rule
actually fires by temporarily adding an unlabelled icon button, then remove it —
a plugin that is configured but not running is the common failure here.

## S3 — Directory tree and infrastructure modules

- Materialize both spec trees, creating directories only where this task places
  a real file.
- `src/server/env.ts` — Zod-parsed environment, `server-only`, fails fast.
- `src/server/logger.ts` — pino, `pino-pretty` in development, `redact` for
  `authorization`, `cookie`, `apiKey`, `set-cookie`.
- `src/server/errors.ts` — `AppError`, `AppErrorCode`.
- `src/app/api/_lib/with-error-handling.ts` — the single boundary translator:
  `ZodError` → `VALIDATION_FAILED`, `AppError` → its status, everything else →
  `INTERNAL` with a logged correlation id.

Validate: `pnpm typecheck`; every file under `src/server/` starts with
`import "server-only"`.

## S4 — Database layer

- `drizzle.config.ts` pointed at `src/server/db/schema` with migrations output
  to `src/server/db/migrations`.
- `src/server/db/client.ts`.
- `src/server/db/schema/app-settings.ts` plus the `schema/index.ts` barrel.
  Text UUIDv7 primary key, `timestamptz` `created_at` / `updated_at`, single
  row with a default. See `design.md` for why this table and not another.
- Generate migration 0000 and commit it.
- `docker-compose.yml` with Postgres and an `docker-entrypoint-initdb.d/`
  script creating `pika_chat_test` alongside the development database.

Validate: `docker compose up -d`, then `pnpm db:migrate` against an empty
database succeeds. Drop the database, recreate, migrate again — the spec
requires clean application from empty, and this is the only stage where that is
cheap to prove.

## S5 — Health vertical slice

- `src/server/services/health.service.ts` — `select 1`, no Next.js in the
  signature.
- `src/app/api/health/route.ts` — wrapped in `withErrorHandling`, no logic.

Validate: `curl` returns success with the database up; stop the database
container and confirm the response is a handled error in the standard shape,
not an unhandled throw or a hung request.

## S6 — shadcn/ui

- Initialize shadcn/ui against Tailwind 4 so `components/ui/` is generated
  territory from the start. Pull one primitive (Button) to prove the pipeline.
- Render it on the home page so `pnpm build` covers it.

Validate: `pnpm build`; `pnpm lint` still clean.

## S7 — Test harness

- Vitest 4 `projects`: `unit-node`, `unit-dom` (jsdom + Testing Library),
  `integration`.
- `globalSetup` for the integration project applies migrations to
  `pika_chat_test`; its URL is a distinct environment variable.
- One unit test and one integration test. The integration test asserts
  `app_settings` exists with its default row — that is the migration proof, kept
  out of the health endpoint deliberately.

Validate: `pnpm test` runs all three projects green. Then stop the database and
confirm the integration project **fails** rather than skipping. A silently
skipping harness would let every later ownership-isolation test pass while
proving nothing.

## S8 — Containers

- Multi-stage `Dockerfile`: deps, build with `output: "standalone"`, slim
  non-root runner on Node 22.
- Bundle `scripts/migrate.ts` into `migrate.mjs` during the build stage; copy it
  and the migrations directory into the runner. Entrypoint:
  `node migrate.mjs && node server.js`. The runner has no pnpm and no
  drizzle-kit — see `design.md`.
- `docker-compose.prod.yml` wiring the image to Postgres.

**Highest-risk stage.** Standalone output misses files surprisingly often
(`public/`, `.next/static`, native deps). Validate by running the built image
against an empty database and loading the page — not by inspecting the build
log.

Validate: `docker build` succeeds; `docker compose -f docker-compose.prod.yml
up` applies migrations on boot and serves the same page as `pnpm dev`.

## S9 — Environment and operator documentation

- `.env.example` covering the database URL, the test database URL, the
  credential encryption secret, and the auth secret placeholder.
- README quickstart: clone, copy env, compose up, migrate, dev.
- State plainly, where a self-hoster will read it, that losing the encryption
  secret permanently orphans every stored provider credential.

Validate: from a clean clone, `cp .env.example .env` plus the documented steps
brings the stack up with no undocumented step.

## S10 — Spec reconciliation (R9)

Re-read `spec/backend/index.md` and `spec/frontend/index.md` against the real
tree. Correct the spec where the implementation legitimately diverged; correct
the implementation where it drifted without reason. Update the "Status of this
spec" section in both files to reflect that the scaffold has landed.

This discharges the obligation `00-bootstrap-guidelines` explicitly refused to
archive away. It is a required part of this task, not a follow-up.

## Full-scope validation before reporting complete

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker build -t pika-chat .
```

Then walk `prd.md`'s acceptance criteria one by one against the running stack.

## Known risky spots

| Area | Risk |
|---|---|
| `ai` / `@ai-sdk/*` versions | Major numbers are offset; a "consistent" resolution is a wrong one. |
| ESLint flat config | Merging the Next config with the two required plugins is where rules silently stop running. |
| Tailwind 4 + shadcn/ui | Tailwind 4 moved config into CSS; older shadcn instructions assume `tailwind.config.js`. |
| Standalone Docker output | Missing static assets surface only at runtime. |
| Vitest 4 `projects` | Replaces the older workspace-file approach; older examples will mislead. |
| `drizzle-kit` 0.31 config | Config shape has changed across recent minors. |

Where a version's actual API is uncertain, check the installed package's own
types or docs rather than reproducing a remembered example.
