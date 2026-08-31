# Authentication and User Management

## Goal

Give a self-hosted pika-chat instance a working identity layer: an operator can
stand up the instance, become its admin, let in exactly the people they intend
to let in, and every later task can ask "who is calling and what may they do"
and get one answer.

This task owns the `Actor` contract that `providers`, `assistants-topics`, and
`chat-streaming` all depend on. Nothing downstream can enforce the ownership
isolation its spec mandates until this lands.

## Background

Source decisions: D2 rule 3, D4, D5, D6 in
`.trellis/tasks/archive/2026-08/00-bootstrap-guidelines/research/tech-stack-decision.md`.
Conventions: `.trellis/spec/backend/` and `.trellis/spec/frontend/`.

The scaffold (`08-31-scaffold`) already provides:

- `src/server/env.ts` — parses `BETTER_AUTH_SECRET` (min 32 chars)
- `src/server/errors.ts` — `AppError`, with `UNAUTHENTICATED` and `FORBIDDEN`
  already in the `AppErrorCode` union
- `src/app/api/_lib/with-error-handling.ts` — the single error-to-response
  boundary producing `{ error: { code, message, details? } }`
- `src/server/db/schema/app-settings.ts` — `app_settings` with
  `allow_registration boolean not null default false` and one seeded row at
  `APP_SETTINGS_ROW_ID`. The scaffold explicitly deferred that flag's
  read/write path to this task.
- `better-auth@1.7.2` in `dependencies`, so far unused

## Confirmed technical facts

Verified by reading `node_modules` at `better-auth@1.7.2`, not from
documentation recall. F1, F2, and F6 each contradict an assumption carried in
from earlier planning, which is why this task needed a design pass rather than
a straight implementation.

**F1 — Better Auth sessions are database sessions, not JWTs.** The `bearer`
plugin (`dist/plugins/bearer/index.mjs`) reads `Authorization: Bearer <token>`,
verifies its HMAC signature, and rewrites it into the session cookie header
before the normal lookup runs. The token is a signed session token whose
authority is the `session` row. The separate `jwt` plugin issues JWT/JWKS for
*third-party* verifiers and is not the session mechanism. "JWT session
strategy" is Auth.js vocabulary that does not map onto Better Auth; the
requirement that actually matters — D2 rule 3, a native client authenticating
without a cookie — is satisfied by `bearer` alone.

**F2 — `emailAndPassword.disableSignUp` cannot implement the D5 toggle.** It is
read from static options at request time (`dist/api/routes/sign-up.mjs:145`),
so changing it needs a process restart. D5 requires an admin-flippable switch,
which is why `app_settings.allow_registration` exists. Enforcement must read
the database per request.

**F3 — Better Auth's default naming violates the project schema convention.**
Defaults are singular (`user`, `session`, `account`, `verification`);
`database-guidelines.md` mandates `snake_case` plural. The drizzle adapter
accepts `usePlural: true` plus a `schema` map, so this is configuration, not a
real conflict.

**F4 — UUIDv7 primary keys are configurable.**
`advanced.database.generateId` accepts a function
(`dist/context/create-context.mjs:106-119`), so auth tables can carry the same
application-generated UUIDv7 ids as every other table.

**F5 — The admin plugin covers roles and moderation, not invitations.** Its
schema adds `role`, `banned`, `banReason`, `banExpires` to user and
`impersonatedBy` to session, and it ships `/admin/create-user`,
`/admin/list-users`, `/admin/set-role`, `/admin/ban-user`,
`/admin/unban-user`, `/admin/set-user-password`, `/admin/remove-user`,
`/admin/impersonate-user`, and session-revocation endpoints. There is no
invite primitive; the `organization` plugin's invitations are org-scoped and
would drag in a model this product does not have.

**F6 — Better Auth 1.7.2 cannot store a user without an email.** In
`@better-auth/core/src/db/get-tables.ts:208-216` the `email` field is
`required: true, unique: true`, with an in-source note that the constraint is
only relaxed in v2 (`TODO(#9124): drop required+unique in v2`). The `username`
plugin does not change this: it adds a `username` column and a
`/sign-in/username` route, but registration still runs through
`/sign-up/email`.

**F7 — Registration must not be the raw Better Auth endpoint.** The D5 runtime
toggle (F2) has to run before an account is created, and
`/api/auth/sign-up/email` has no place to put it. A project-owned handler in
front of sign-up is mandatory, and the raw sign-up route must not remain
independently reachable, or a client bypasses the check by calling it directly.

**F8 — No UUIDv7 generator exists yet.** `crypto.randomUUID()` is v4 only; the
`{version: 7}` option is ignored on Node 22 and 24. The scaffold satisfied
`database-guidelines.md`'s "application-generated UUIDv7" rule with a single
hardcoded literal and never needed a runtime generator. This task is the first
that does, so it introduces one for the whole project.

## Decisions

**D-ADMIN-1 — The first account is created by a first-run setup wizard.** A
`/setup` page is reachable only while the instance has zero users. The
zero-users check is enforced in the service layer, not by hiding the route.
The account's role is `super_admin` (D-ROLE-1).

Rejected: env-var seeding leaves the admin password in `docker-compose.yml` and
becomes a lying config value once the password changes; a CLI script would need
its own bundle step, because the standalone runner image contains neither pnpm
nor drizzle-kit (recorded in the scaffold design).

**D-USER-1 — Email is required and unique; deliverability is not verified.**
Following F6, the product follows Better Auth's model rather than working
around it. Email is validated for format only. No verification mail is sent,
`emailVerification` stays unconfigured, and `requireEmailVerification` stays
off — a self-hosted instance usually has no SMTP, and an unverifiable account
must still be able to sign in. `emailVerified` therefore stays `false` for
every phase-1 account and must not be read as a trust signal.

**D-USER-2 — Username is a second unique identifier, and either identifier can
sign in.** The `username` plugin is enabled. One "username or email" field on
the sign-in form resolves to `/sign-in/username` or `/sign-in/email`.

**D-INVITE-1 — No invite codes in phase 1.** Admission is admin-provisioned
accounts plus the global registration toggle. An `invites` table, code
generation, single-use consumption under concurrency, and its UI are deferred.
Consequence: the admin necessarily learns each new user's initial password,
which is why R9 (self-service password change) is in scope rather than
deferred.

**D-SCOPE-1 — This task ships its own UI.** With invites gone,
`/admin/create-user` is the only way a second person gets an account, so an
admin user-management screen is a functional requirement, not polish. Layout
stays plain; `08-31-app-shell` owns the visual system and will restyle these
screens later.

**D-ROLE-1 — Three roles; the first account is an immutable super admin.**

Roles: `super_admin`, `admin`, `user`. Setup is the only way to mint
`super_admin`. The create-user form still offers only `admin` and `user`.
There is no later path that assigns `super_admin`, and no path that changes a
`super_admin`'s role.

"Modify" in this task means the operations the admin screen already has: change
role, ban/unban, reset password. Username and email are not editable this
round. Everyone changes their *own* password at `/account` with the current
password; that path is not an admin action.

| Actor | Change role / ban / reset password of |
|---|---|
| `super_admin` | any `admin` or `user`; never a `super_admin` (including themselves) |
| `admin` | themselves are not a target of these admin actions; they may act on `user` only — not other admins, not the super admin |
| `user` | nobody; they only use `/account` |

Additionally: nobody may set a role of `super_admin` via create or set-role;
nobody may change their own role (that is the hole that just locked the
operator out). `super_admin` cannot be banned and cannot have their password
reset through the admin API.

Staff (`super_admin` and `admin`) can both list users, create `admin`/`user`
accounts, and flip the registration toggle. Listing is not "modify".

Better Auth's `/admin/set-role` does not enforce target hierarchy. The rule
lives in a project hook in front of `set-role`, `ban-user`, `unban-user`,
`set-user-password`, and `create-user`. Hiding buttons is not sufficient.

Existing instances that already ran setup with role `admin` are backfilled:
if no `super_admin` row exists, the earliest `users.created_at` row becomes
`super_admin`.

## Requirements

**R1 — Better Auth is configured and mounted.** Email+password, `username`,
`bearer`, and `admin` plugins, drizzle adapter against the existing Postgres
connection, mounted at `/api/auth/[...all]`. Table and column naming follows
`database-guidelines.md` (F3), and ids are application-generated UUIDv7 (F4,
F8). Its tables are created by a committed drizzle-kit migration that applies
cleanly from an empty database.

**R2 — `Actor` is the single authorization contract.** A helper resolves the
caller from request `Headers` into `{ userId, role }` where `role` is
`super_admin` | `admin` | `user`, accepting either the session cookie or
`Authorization: Bearer`, and throws `UNAUTHENTICATED` when absent.
`requireAdmin` allows `super_admin` and `admin`. Service functions receive
the resulting `Actor` as a parameter and never resolve it themselves.

**R3 — First-run setup.** While the instance has zero users, `/setup` accepts a
username, email, and password and creates the first account with role
`super_admin`, signing them in. Once any user exists, both the page and its
endpoint refuse.

**R4 — Sign in and sign out.** One form accepts either username or email plus
password. Failures are indistinguishable regardless of which part was wrong.
Sign-out revokes the session.

**R5 — Registration is gated by the runtime toggle.** A project-owned endpoint
reads `app_settings.allow_registration` per request (F2) and rejects with
`FORBIDDEN` when off. The raw Better Auth sign-up route is not independently
reachable (F7). When the toggle is on, registration creates a `user`-role
account.

**R6 — Route protection.** Unauthenticated requests to the authenticated
surface redirect to sign-in; authenticated users hitting `/setup` or the
auth pages are redirected away. Admin-only pages and endpoints reject
non-staff (`user` role) server-side. `super_admin` and `admin` both enter
the admin surface.

**R7 — Staff user management, with D-ROLE-1 hierarchy.** Staff can list users
and create an account (username, email, password, role `admin` or `user`).
Change-role, ban/unban, and reset-password follow the D-ROLE-1 table. The
admin screen hides actions the caller cannot take; the hook still rejects a
crafted request.

**R8 — Staff controls the registration toggle.** `super_admin` and `admin`
read and write `app_settings.allow_registration`.

**R9 — Users can change their own password.** Requires the current password.
This is what keeps D-INVITE-1's admin-set initial password from being permanent.
It is also the only way a `super_admin` password changes.

**R10 — Banned users cannot act.** A ban takes effect on the next request, not
only at next sign-in; existing sessions stop working. A `super_admin` cannot
be banned.

**R11 — Super-admin uniqueness and immutability.** At most one `super_admin`.
Create-user and set-role reject `super_admin` as a requested role. A
`super_admin`'s role cannot change.

## Acceptance Criteria

Behavioural, verifiable from tests or a running instance.

- [ ] **AC1** From an empty database, `pnpm db:migrate` succeeds and `/setup`
      creates a `super_admin` who lands signed-in on the authenticated surface.
- [ ] **AC2** After AC1, `/setup` and its endpoint both refuse, including when
      the endpoint is called directly with a crafted request.
- [ ] **AC3** That super admin can sign in with their username and, separately,
      with their email; both yield a working session.
- [ ] **AC4** A wrong password and a nonexistent identifier produce the same
      status code and the same message.
- [ ] **AC5** With `allow_registration = false` (the default), the registration
      endpoint returns `FORBIDDEN`; `POST /api/auth/sign-up/email` does not
      create a user either.
- [ ] **AC6** An admin flips the toggle on; registration then succeeds and
      produces a `user`-role account. Flipping it back off blocks the next
      registration with no restart.
- [ ] **AC7** A `user`-role caller receives `FORBIDDEN` from every admin
      endpoint, verified against the service function rather than the UI.
- [ ] **AC8** An admin creates an account from the admin screen; that user
      signs in with the given credentials.
- [ ] **AC9** A request carrying only `Authorization: Bearer <token>` and no
      cookie is authenticated and resolves to the same `Actor` as the cookie
      path.
- [ ] **AC10** After an admin bans a user, that user's existing session is
      rejected on its next request.
- [ ] **AC11** A user changes their own password with the correct current
      password; the old password then fails and the new one works. Supplying a
      wrong current password fails.
- [ ] **AC12** Auth table ids are UUIDv7, and table names are `snake_case`
      plural, matching `database-guidelines.md`.
- [ ] **AC13** `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass; no password
      hash, session token, or credential appears in any log line.
- [ ] **AC14** `POST /api/auth/admin/set-role` targeting the `super_admin`, or
      requesting role `super_admin`, returns `FORBIDDEN`. A crafted
      self-demotion by an `admin` also returns `FORBIDDEN`.
- [ ] **AC15** An `admin` receives `FORBIDDEN` when changing role, banning, or
      resetting the password of another `admin` or the `super_admin`. The same
      admin can perform those actions on a `user`.
- [ ] **AC16** Ban and admin password-reset against the `super_admin` return
      `FORBIDDEN`. The super admin can still change their own password at
      `/account`.
- [ ] **AC17** After migrate on a database whose first user is still `admin`
      and which has no `super_admin`, that earliest user becomes `super_admin`.

## Out of Scope

- Invite codes (D-INVITE-1)
- Email verification, password-reset-by-email, and any SMTP dependency
  (D-USER-1); a user who forgets their password needs an admin reset
- Forced password change on first login
- OAuth and social sign-in
- Two-factor authentication
- Hard user deletion. `/admin/remove-user` is deliberately not surfaced:
  `database-guidelines.md` forbids cascading deletes on message data without an
  explicit product decision, and the tables that would cascade do not exist
  yet. Ban is the phase-1 answer.
- Admin impersonation
- Per-user token usage accounting (D5 defers it; the schema should not block it)
- Organizations, teams, or any multi-tenant grouping
- Visual design of these screens; `08-31-app-shell` owns that (D-SCOPE-1)
- Editing username or email (D-ROLE-1: not this round)
- Transferring `super_admin` to another account, or minting a second one

