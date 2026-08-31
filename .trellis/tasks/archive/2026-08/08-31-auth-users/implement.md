# Implement — Authentication and User Management

Execution plan for `prd.md` / `design.md`. Ordered so that each step is
verifiable before the next one depends on it; the rationale for every choice
lives in `design.md` and is not repeated here.

## Prerequisites

```bash
docker compose up -d          # Postgres for dev + pika_chat_test
pnpm install
```

## Step 1 — UUIDv7 generator

- [ ] `pnpm add uuid@14.0.2`
- [ ] `src/lib/id.ts` exporting `newId(): string` (UUIDv7)
- [ ] `src/lib/id.test.ts`: version nibble is `7`, and ids minted in a tight
      loop sort ascending as strings (the monotonicity property v7 was chosen
      for)

Verify: `pnpm test -- id`

## Step 2 — Auth schema and migration

- [ ] `src/server/db/schema/auth.ts` — `users`, `sessions`, `accounts`,
      `verifications`. Drizzle keys camelCase, SQL columns `snake_case`,
      `text` ids, `timestamptz`. Include the `admin` plugin's columns (`role`,
      `banned`, `ban_reason`, `ban_expires`, `impersonated_by` on sessions) and
      the `username` plugin's (`username`, `display_username`, unique).
      No `import "server-only"` here — drizzle-kit loads these files.
- [ ] `src/server/db/schema/index.ts` — barrel re-exporting `app-settings` and
      `auth`
- [ ] Repoint `drizzle.config.ts` at the schema directory
- [ ] Update `src/server/db/client.ts` to pass the full schema
- [ ] `pnpm db:generate` → review the SQL by hand before committing
- [ ] `pnpm db:migrate`

Verify: migration applies to an empty database, not just the current one:

```bash
docker compose down -v && docker compose up -d && pnpm db:migrate
```

Rollback point: the migration file is immutable once committed. If the schema
is wrong after this step, fix it in a *new* migration.

## Step 3 — Better Auth instance

- [ ] `src/server/auth/index.ts`: `betterAuth({...})` with
      - `database: drizzleAdapter(getDb(), { provider: "pg", schema: { user: users, session: sessions, account: accounts, verification: verifications } })`
      - `emailAndPassword: { enabled: true }`, no email verification
      - plugins: `username()`, `bearer()`, `admin()`, `nextCookies()`
      - `advanced.database.generateId: () => newId()`
      - `disabledPaths: ["/sign-up/email"]`
      - **no `session.cookieCache`** — see design; enabling it breaks ban
        immediacy
- [ ] `src/app/api/auth/[...all]/route.ts` via `toNextJsHandler`

Verify: `GET /api/auth/ok` responds, and `POST /api/auth/sign-up/email`
returns 404.

## Step 4 — Actor contract

- [ ] `src/server/auth/actor.ts`: `Actor`, `resolveActor(headers)`,
      `requireActor(headers)`, `requireAdmin(headers)`. Parameter is `Headers`,
      never `NextRequest`.
- [ ] Throw `AppError` with `UNAUTHENTICATED` / `FORBIDDEN`

This is the contract three sibling tasks consume — review it before building on
it.

## Step 5 — Instance settings

- [ ] `src/server/services/instance-settings.service.ts`: read/write
      `allow_registration` by `APP_SETTINGS_ROW_ID`, `updated_at` maintained
- [ ] `GET /api/instance` → `{ needsSetup, allowRegistration }` only. No user
      count, no other field.
- [ ] `GET`/`PATCH /api/admin/settings` behind `requireAdmin`
- [ ] Both handlers wrapped in `withErrorHandling`, bodies parsed with Zod

## Step 6 — First-run setup

- [ ] `src/server/services/setup.service.ts`: inside one transaction, count
      users, refuse if non-zero, else `auth.api.createUser({ body: { ...,
      role: "admin" } })` with **no headers**
- [ ] Pre-check username availability; still map the unique violation to
      `CONFLICT`
- [ ] `POST /api/setup`, then establish a session for the new admin

Verify now, not at the end: call `/api/setup` twice with different payloads.
The second must fail. This is AC2 and the single highest-severity check in the
task.

## Step 7 — Gated registration

- [ ] `src/server/services/registration.service.ts`: read the toggle per
      request, `FORBIDDEN` when off, else create a `user`-role account
- [ ] `POST /api/registration`

Verify: with the toggle off, both `/api/registration` (403) and
`/api/auth/sign-up/email` (404) refuse.

## Step 8 — Integration tests for the backend

Write these before the UI, while the contracts are fresh. Real database, no
mocks.

- [ ] setup succeeds once, then refuses a crafted direct call — AC1, AC2
- [ ] sign-in by username and by email — AC3
- [ ] wrong password vs unknown identifier are identical responses — AC4
- [ ] registration blocked while toggle off; sign-up route 404 — AC5
- [ ] toggle flipped at runtime, no restart — AC6
- [ ] every admin endpoint rejects a `user` caller — AC7, write exhaustively
- [ ] bearer-only request equals cookie path — AC9
- [ ] ban deletes sessions, next request fails — AC10
- [ ] password change invalidates the old password — AC11
- [ ] ids are UUIDv7 — AC12

Verify: `pnpm test`

## Step 9 — Auth pages

- [ ] Add a `unit-dom` project (jsdom + Testing Library) to
      `vitest.config.mts`; the scaffold planned it but only created
      `unit-node` and `integration`
- [ ] `src/lib/auth-client.ts` — Better Auth React client with the `username`
      and `admin` client plugins
- [ ] `(auth)/setup`, `(auth)/sign-in`, `(auth)/sign-up`
- [ ] Sign-in: one "username or email" field, routed on `@`. **Both branches
      must render one identical failure message** — AC4's client half
- [ ] `/sign-up` is only reachable when `allowRegistration` is true
- [ ] `"use client"` at the form leaf, not on the page

## Step 10 — Route protection

- [ ] Authenticated layout redirects anonymous visitors to `/sign-in`
- [ ] `/setup` and auth pages redirect an already-authenticated user away
- [ ] Admin pages check role server-side, not only in rendering

The redirect is convenience; `requireActor` / `requireAdmin` on the handler is
the control. Do not let a redirect become the only check.

## Step 11 — Admin user management

- [ ] `admin/users`: list, create, change role, ban/unban, reset password
- [ ] Calls go to `/api/auth/admin/*` through the client SDK, **with** session
      headers — never through a headerless server-side proxy
- [ ] Do not surface `remove-user` (out of scope; ban is the phase-1 answer)

## Step 12 — Self-service password change

- [ ] Form requiring the current password, via the client SDK
- [ ] Reachable while signed in

## Step 13 — Component tests

Only where a rule is encoded, per the frontend spec:

- [ ] `/sign-up` entry hidden when `allowRegistration` is false
- [ ] admin-only controls absent for a `user`-role session

## Step 14 — Finish

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] Grep the diff for logging of passwords, hashes, tokens, or cookies —
      AC13
- [ ] Confirm no service signature mentions `NextRequest` / `NextResponse`
- [ ] Confirm no `any`, no `!`, no unchecked `as`
- [ ] Note the `BETTER_AUTH_SECRET` rotation consequence in the operator docs
- [ ] Update `.trellis/spec/backend/` with the auth conventions this task
      establishes (the `Actor` contract, the headerless-`createUser` hazard,
      the cookie-cache prohibition)

## Step 15 — Role hierarchy (D-ROLE-1)

This is a requirements change after steps 1–14 landed. Do not re-do them;
layer this on top.

- [ ] `admin({ defaultRole: "user", adminRoles: ["super_admin", "admin"] })`
- [ ] `src/server/auth/hierarchy.ts`: `canAdminister(actor, target, action)`
      plus a Better Auth `hooks.before` matcher for
      `/admin/set-role`, `/admin/ban-user`, `/admin/unban-user`,
      `/admin/set-user-password`, `/admin/create-user`
- [ ] `Actor.role` includes `super_admin`; `requireAdmin` treats both staff
      roles as allowed; `roleFromSession` recognises `super_admin`
- [ ] `setup.service.ts` creates `role: "super_admin"`
- [ ] Generated SQL migration: if no `super_admin` exists, update the earliest
      `users.created_at` row. Never edit `0001_*`
- [ ] Admin UI: create-user select stays `admin` | `user`; hide set-role / ban
      / reset-password when `canAdminister` would fail (including on the super
      admin row and on the caller's own row for set-role)
- [ ] Integration tests for AC14–AC17
- [ ] Update `.trellis/spec/backend/auth-guidelines.md` with the three-role
      contract and the hook rule

Verify: `pnpm lint && pnpm typecheck && pnpm test`

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm test
docker compose down -v && docker compose up -d && pnpm db:migrate   # clean-DB check
```

## Risky files and rollback points

| File | Risk |
|---|---|
| `src/server/db/migrations/**` | Immutable once applied anywhere. Fix forward. |
| `drizzle.config.ts` | Repointing to a directory can silently miss tables; verify the generated SQL lists all four. |
| `src/server/auth/index.ts` | `disabledPaths`, the absent `cookieCache`, and `adminRoles` are load-bearing. |
| `src/server/auth/hierarchy.ts` | This is the control for D-ROLE-1. UI hiding is not a substitute. |
| `setup.service.ts`, `registration.service.ts` | The only two places allowed to call `createUser` headerless. Each must gate first. |
| `src/server/db/client.ts` | Shared by everything the scaffold already ships; a bad schema wiring breaks the health check too. |

Overall rollback is `git revert` of this task's commits plus dropping the four
tables. There is no deployed instance and no data to preserve.

## Before `task.py start`

- [ ] `prd.md`, `design.md`, `implement.md` reviewed by the user
- [ ] `implement.jsonl` and `check.jsonl` updated — the seeded versions predate
      the UI scope (D-SCOPE-1) and list no frontend spec
