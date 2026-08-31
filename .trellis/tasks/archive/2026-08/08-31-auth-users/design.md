# Design — Authentication and User Management

Technical design for the requirements in `prd.md`. Every claim about Better
Auth below was verified by reading `node_modules` at `better-auth@1.7.2`; file
and line anchors are given so a reviewer can check them without trusting recall.

## The shape of the problem

Better Auth already implements almost all of R1–R10. The work in this task is
therefore not "build auth" — it is deciding **which parts of the library are
exposed directly, which are wrapped, and which are switched off**, and then
making the project's own two rules (the D5 runtime toggle and the zero-users
setup gate) impossible to bypass.

Getting that boundary wrong in either direction is the main risk. Wrap too
much and this task reimplements a library it already trusts; wrap too little
and a client reaches an endpoint that skips a check.

## Architecture

```
src/
├── lib/id.ts                            newId() → UUIDv7          (new, project-wide)
├── server/
│   ├── auth/
│   │   ├── index.ts                     betterAuth() instance
│   │   └── actor.ts                     Actor contract + resolvers
│   ├── db/schema/
│   │   ├── auth.ts                      users / sessions / accounts / verifications
│   │   └── index.ts                     re-export barrel (spec requires it at 2 files)
│   └── services/
│       ├── setup.service.ts             zero-users gate, first admin
│       ├── registration.service.ts      toggle gate, self-registration
│       └── instance-settings.service.ts app_settings read/write
└── app/
    ├── api/
    │   ├── auth/[...all]/route.ts       Better Auth catch-all
    │   ├── instance/route.ts            GET public instance state
    │   ├── setup/route.ts               POST first admin
    │   ├── registration/route.ts        POST self-registration
    │   └── admin/settings/route.ts      GET/PATCH allow_registration
    ├── (auth)/{setup,sign-in,sign-up}/  unauthenticated pages
    └── admin/users/                     admin user management
```

### What is exposed directly, and why

Sign-in, sign-out, get-session, password change, and the whole `/admin/*`
family are reached through the Better Auth catch-all and called from the
browser with its own client SDK. They get no wrapper.

This is a deliberate reading of the spec's "every business capability is
reachable as an HTTP Route Handler" (D2 rule 1). The catch-all *is* a Route
Handler; `POST /api/auth/admin/list-users` is a plain HTTP endpoint that a
future native client can call. The constraint is about not hiding capabilities
behind Server Actions or RSC, and mounting the catch-all satisfies it. Adding a
pass-through handler per endpoint would add code whose only effect is to
restate the library's own authorization.

The accepted cost is **two error shapes on the wire**: project endpoints return
`{ error: { code, message, details? } }` via `withErrorHandling`, Better Auth
endpoints return its own body. The split is drawn along a boundary a reader can
predict — anything under `/api/auth/**` is the library's shape, everything else
is ours — and the frontend already needs the Better Auth client SDK for session
management, so it is not paying an extra abstraction either way. The
alternative, wrapping ~12 endpoints to normalise a field name, is not worth it.

### What is wrapped, and why it must be

Three endpoints exist because a project rule has to run before the library
does:

| Endpoint | Rule it enforces |
|---|---|
| `POST /api/setup` | R3 — only while the instance has zero users |
| `POST /api/registration` | R5 — only while `allow_registration` is true (F2) |
| `GET/PATCH /api/admin/settings` | R8 — `app_settings` is our table, not the library's |

`GET /api/instance` is a fourth, and it is not a security boundary: it returns
`{ needsSetup, allowRegistration }` so the unauthenticated UI can decide
whether to render setup, sign-in, or sign-up. It must expose nothing beyond
those two booleans — notably not a user count, which would leak instance size
to anonymous callers.

### What is switched off

```ts
disabledPaths: ["/sign-up/email"]
```

`dist/api/index.mjs:164-166` checks `disabledPaths` in the router's `onRequest`
and returns 404. Critically, this is a **transport-level** block: it does not
affect server-side `auth.api.*` calls, which never enter the router.

That asymmetry is exactly what R5 and AC5 need. The public sign-up route
disappears, while our own services can still create users through the library.
Without it, `POST /api/auth/sign-up/email` would remain a way to create an
account with no toggle check — the hole F7 describes.

## How users get created

Both creation paths call `auth.api.createUser({ body })` **with no `headers`
and no `request`**.

`dist/plugins/admin/routes.mjs:153-154` reads:

```js
const session = await getAuthoritativeSessionFromCtx(ctx);
if (!session && (ctx.request || ctx.headers)) throw ctx.error("UNAUTHORIZED");
if (session) { /* permission checks */ }
```

So an in-process call with no request context skips every permission check —
Better Auth's trusted-server-call convention. It is what lets `/api/setup`
mint an `admin` before any admin exists to authorize it.

**This is the sharpest edge in the task.** The same property means that any
future handler which forwards an admin action but forgets to pass `headers`
silently drops authorization. Two mitigations, both required:

1. Only `setup.service.ts` and `registration.service.ts` may call `createUser`
   without headers, and each takes its own gate first.
2. The admin surface does not proxy `createUser` at all — the browser calls
   `/api/auth/admin/create-user` directly, where `headers` are present and the
   plugin enforces permissions.

Note the inconsistency in the library worth knowing before extending this:
`createUser` hand-rolls its session check, while `banUser` and friends use
`use: [adminMiddleware]` (`routes.mjs:511`) and therefore cannot be called
headerless at all. Do not assume the trusted-call pattern generalises.

### The gap `createUser` leaves

`createUser` writes through `internalAdapter.createUser`, bypassing the
`/sign-up/email` endpoint. The `username` plugin's uniqueness check is an
endpoint hook matched on `/sign-up/email` and `/update-user`
(`dist/plugins/username/index.mjs:258-283`), so it **does not run** here.

The `username` field is declared `unique: true`, so a collision still fails —
but as a raw Postgres unique-violation, not as `USERNAME_IS_ALREADY_TAKEN`.
Both services must therefore check username availability before creating, and
still translate the constraint violation into `CONFLICT`, because the check
and the insert are not atomic. The pre-check is for the error message; the
constraint is what actually guarantees correctness.

The field's `transform.input` normaliser (`plugins/username/schema.mjs`) is an
adapter-level concern and *does* run, so case-folding is consistent on both
paths.

## The two project gates

### Zero-users (R3, AC2)

`setup.service.ts` counts users and refuses if the count is non-zero. The check
lives in the service, so the page merely renders what the service would allow.

This is a genuine time-of-check/time-of-use race: two concurrent `/api/setup`
posts could both observe zero. The mitigation is not a lock — it is that the
first successful insert makes the second one's username or email collide, and
in the worst case the loser gets a `CONFLICT`. To make that guarantee real
rather than incidental, the count and the create run **inside one
transaction**.

Hiding the route is not a control. AC2 requires the endpoint to refuse a
crafted direct request, which is the only test that distinguishes a real gate
from a hidden link.

### Registration toggle (R5, AC6)

`registration.service.ts` reads `app_settings.allow_registration` **per
request**. This is the whole reason the flag is a row and not
`emailAndPassword.disableSignUp`: F2 established the latter is static options,
so flipping it would need a restart, and AC6 explicitly requires no restart.

The read is a single indexed lookup by `APP_SETTINGS_ROW_ID`, so it does not
warrant a cache. Adding one would reintroduce exactly the staleness the row
model was chosen to avoid.

## The `Actor` contract

This is the durable output of the task; three sibling tasks depend on it.

```ts
export type Actor = { userId: string; role: "super_admin" | "admin" | "user" };

export async function resolveActor(headers: Headers): Promise<Actor | null>;
export async function requireActor(headers: Headers): Promise<Actor>;  // → UNAUTHENTICATED
export async function requireAdmin(headers: Headers): Promise<Actor>;  // staff: super_admin | admin
```

The parameter is `Headers`, not `NextRequest`. That keeps the directory-structure
spec's signature rule satisfiable end to end: the resolver is callable from a
Route Handler, from a future non-Next transport, and from a Vitest test with a
hand-built `Headers` object and no HTTP mock.

Resolution delegates to `auth.api.getSession({ headers })`. Cookie and bearer
converge before this point: the `bearer` plugin rewrites
`Authorization: Bearer <token>` into the session cookie header in a `before`
hook (`dist/plugins/bearer/index.mjs:22-49`), so both transports produce an
identical `Actor` with no branching of ours. That is what makes AC9 a test of
configuration rather than of a second code path.

Handlers call `requireActor`/`requireAdmin`; services take the result as a
parameter and never resolve it themselves. `roleFromSession` treats a comma-
separated Better Auth role string as staff if it contains `super_admin` or
`admin`.

## Role hierarchy (D-ROLE-1)

Better Auth's admin plugin treats every name in `adminRoles` as fully
privileged against every user. Target hierarchy is not its job, so it will
happily demote the only staff account — which is what just happened.

Configure the plugin as:

```ts
admin({
  defaultRole: "user",
  adminRoles: ["super_admin", "admin"],
})
```

Then add a project `before` hook (one module, e.g. `src/server/auth/hierarchy.ts`)
on `/admin/set-role`, `/admin/ban-user`, `/admin/unban-user`,
`/admin/set-user-password`, and `/admin/create-user`. The hook loads the target
user (or the requested create payload) and throws `FORBIDDEN` unless
`canAdminister(actor, target, action)` holds.

Rules, matching the PRD table:

- Requested role `super_admin` is always rejected.
- A `super_admin` row is never a target of set-role, ban, unban, or
  set-user-password.
- An actor may not set-role on themselves.
- `admin` may set-role / ban / reset-password only when the target's role is
  `user`.
- `super_admin` may do those to `admin` and `user`.
- `/account` password change is unchanged and is the only way a super admin
  password changes.

The admin UI hides the buttons the caller cannot use. The hook is the control;
the UI is not.

Setup calls `createUser` with `role: "super_admin"` (still headerless). A
SQL data migration backfills existing instances: if no row has
`role = 'super_admin'`, the earliest `created_at` user becomes one.

## Session configuration

**Cookie cache stays off.** This is a real decision with a security
consequence, not a default we happened to keep.

`banUser` enforces bans by deleting the user's session rows
(`routes.mjs:540`), and the admin plugin's own `banned` check runs only in the
`session.create` hook (`admin.mjs:33-49`) — i.e. at sign-in, not per request.
So ban immediacy (R10, AC10) rests entirely on those rows disappearing. If
`session.cookieCache` were enabled, a cached session would keep authorizing
requests after the row was deleted, for the cache's lifetime. Better Auth's own
source flags this hazard on `disableCookieCache`
(`dist/api/routes/session.d.mts:53-57`).

The cost is one database read per authenticated request. On a self-hosted
instance with a co-located Postgres that is not a bottleneck worth trading
correctness for, and revisiting it later means adding a cache to a working
system rather than removing one from a broken one.

## Schema

`src/server/db/schema/auth.ts` hand-writes the four Drizzle tables rather than
running the Better Auth CLI generator, because the generator's output does not
follow this project's naming rules and would have to be rewritten anyway.

| Better Auth model | Table | Reason |
|---|---|---|
| `user` | `users` | `database-guidelines.md`: `snake_case`, plural |
| `session` | `sessions` | |
| `account` | `accounts` | |
| `verification` | `verifications` | unused in phase 1 (D-USER-1) but part of core schema |

Two mappings make this work, and they operate at different levels:

- **Table names**: the adapter receives an explicit map,
  `schema: { user: users, session: sessions, ... }`. Explicit mapping is
  preferred over `usePlural: true`, which pluralises by string-concatenating
  `"s"` (`@better-auth/core` `get-model-name.ts:33`) — correct for these four
  nouns, but a rule that silently mis-derives the moment a plugin adds a table
  whose plural is irregular.
- **Column names**: no mapping needed. Drizzle keys stay camelCase while the
  SQL column is snake_case (`emailVerified: boolean("email_verified")`). The
  adapter addresses the Drizzle object by key, so it sees the camelCase names
  it expects and Postgres sees the project's convention.

`verifications` is created even though nothing writes to it. Omitting a table
the library's core schema declares would leave the instance one config change
away from a runtime failure, and an empty table costs nothing.

`schema/index.ts` appears now because `database-guidelines.md` requires the
barrel once a second domain file exists; `drizzle.config.ts` is repointed from
the single file to the directory.

### Ids

`advanced.database.generateId: () => newId()`, where `newId` is UUIDv7
(`dist/context/create-context.mjs:106-119` accepts a function). This keeps auth
rows consistent with every other table (AC12) and preserves the index locality
that motivated UUIDv7 in the spec.

F8 established no generator exists yet — `crypto.randomUUID()` is v4 and the
`{version: 7}` option is ignored on Node 22 and 24. So this task adds
`uuid@14.0.2` and `src/lib/id.ts`.

Dependency over hand-rolled: a correct UUIDv7 needs a monotonic counter so that
ids minted within the same millisecond still sort by creation order. That is
the property the whole choice of v7 exists for, it is the easy part to get
subtly wrong, and it is untestable by inspection. `uuid` is a single
well-maintained package with no transitive dependencies.

`src/lib/` is the right home: id generation is pure, does no IO, holds no
secret, and a future client may need to mint an optimistic id.

## Migration

One drizzle-kit migration creating the four tables, generated (never
hand-written) and committed with the schema change in the same commit. It must
apply cleanly onto the scaffold's `0000` baseline and from an empty database.

Rollback is a `git revert` plus dropping the four tables; there is no deployed
instance and no data to preserve. Nothing in this task alters `app_settings`'s
shape — it only adds the read/write path the scaffold deferred — so no
destructive change is involved.

## Frontend

Two data paths, split on the same boundary as the endpoints:

- Better Auth client SDK for sign-in, sign-out, session, password change, and
  `admin.*`
- `fetch` + TanStack Query for `/api/instance`, `/api/setup`,
  `/api/registration`, `/api/admin/settings`

`GET /api/instance` drives unauthenticated routing: `needsSetup` sends visitors
to `/setup`, `allowRegistration` decides whether `/sign-up` is offered at all.

Sign-in submits one "username or email" field. The client picks
`/sign-in/username` or `/sign-in/email` on the presence of `@`. That branch is
routing, not an authorization rule, so client-side is acceptable — a caller who
picks wrong gets an authentication failure, not access. **Both branches must
surface one identical failure message** (AC4); this is the most likely place to
accidentally build an account-enumeration oracle, because the two endpoints
return different error codes underneath.

Route protection (R6) is a layout-level session check that redirects, plus the
server-side checks that actually enforce access. The redirect is a convenience;
`requireActor`/`requireAdmin` on the handler is the control.

Styling stays plain — `08-31-app-shell` owns the visual system (D-SCOPE-1).
These screens should use existing `components/ui` primitives so that restyling
later is a theme change rather than a rewrite.

## Testing

Integration tests against the real `pika_chat_test` database, using the harness
the scaffold built. Auth is the one area where mocked tests are close to
worthless: every requirement here is about what the *database* and the
*library* agree on.

Required cases, mapping to the acceptance criteria:

| Case | AC |
|---|---|
| `/api/setup` succeeds on an empty instance, then refuses a direct crafted call | AC1, AC2 |
| Sign-in by username and by email yield equivalent sessions | AC3 |
| Wrong password and unknown identifier are byte-identical responses | AC4 |
| Registration blocked while toggle is off; `/api/auth/sign-up/email` returns 404 | AC5 |
| Toggle flipped at runtime changes behaviour with no restart | AC6 |
| Every admin endpoint rejects a `user`-role caller | AC7 |
| Bearer-only request resolves to the same `Actor` as the cookie path | AC9 |
| Ban deletes sessions; the banned user's next request fails | AC10 |
| Password change invalidates the old password | AC11 |

AC7 is the one to write exhaustively rather than representatively. It is the
first task where a role check exists at all, and `providers` will inherit the
pattern.

## Trade-offs

**Two error shapes on the wire.** Justified above; the boundary is predictable
and the alternative is a wrapper per endpoint.

**Client-side identifier routing.** Slightly weakens the "logic on the server"
instinct, in exchange for not writing a sign-in wrapper whose only job is a
substring test. Safe because the failure mode is a denied sign-in.

**No cookie cache.** One DB read per request, bought for correct ban semantics.

**Admin learns initial passwords.** Inherited from D-INVITE-1, bounded by R9.

## Operational notes

`BETTER_AUTH_SECRET` already exists in `env.ts` and `.env.example`. It signs
session tokens, so rotating it invalidates every session — an inconvenience,
not data loss, and worth a line in the operator docs next to the existing
warning about `CREDENTIAL_ENCRYPTION_SECRET`.

The default posture of a fresh instance is closed: `allow_registration` is
`false` (scaffold default) and the only way in is `/setup` followed by
admin-provisioned accounts. A self-hoster who exposes the instance before
completing setup is the one real window of risk, and it closes the moment the
first account exists.
