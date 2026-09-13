# Auth Guidelines

> Better Auth wiring, the `Actor` contract, and the two project-owned gates.

---

## `Actor`

Downstream services receive an `Actor`; they never resolve the caller themselves.

```ts
export type Actor = { userId: string; role: "super_admin" | "admin" | "user" };

export async function resolveActor(headers: Headers): Promise<Actor | null>;
export async function requireActor(headers: Headers): Promise<Actor>;
export async function requireAdmin(headers: Headers): Promise<Actor>;
```

The parameter is `Headers`, never `NextRequest`. Cookie and
`Authorization: Bearer` converge inside Better Auth's `bearer` plugin before
`getSession` runs, so both transports produce the same `Actor`.

`requireAdmin` allows both staff roles (`super_admin` and `admin`).
`roleFromSession` / `parseActorRole` treats a comma-separated Better Auth role
string as `super_admin` if it contains that name, otherwise `admin` if it
contains `admin`, otherwise `user`.

## Role hierarchy

Three roles. Setup is the only way to mint `super_admin`. Create-user and
set-role never assign it afterwards, and a `super_admin` row is never a
target of set-role, ban, unban, or admin password-reset.

| Actor | Change role / ban / reset password of |
|---|---|
| `super_admin` | any `admin` or `user`; never a `super_admin` (including themselves) |
| `admin` | `user` only — not other admins, not the super admin, not themselves |
| `user` | nobody |

The same target hierarchy is enforced for project-owned admin mutations that
live outside Better Auth's routes — currently `set-quota`
(`PATCH /api/admin/users/[userId]/quota`) via
`canAdminister(actor, target, "set-quota")` in `src/lib/auth-hierarchy.ts`.
Better Auth knows nothing about the `users.file_quota_bytes` column, so the
service, not the library, is the gate.

Staff (`super_admin` and `admin`) can both list users, create `admin`/`user`
accounts, and flip the registration toggle.

The admin plugin is configured with
`adminRoles: ["super_admin", "admin"]` so both names are fully privileged
inside Better Auth. Target hierarchy is **not** the plugin's job. It lives in
`src/server/auth/hierarchy.ts` as a `hooks.before` matcher on
`/admin/set-role`, `/admin/ban-user`, `/admin/unban-user`,
`/admin/set-user-password`, `/admin/create-user`, and `/admin/update-user`. The hook calls
`canAdminister` and throws `FORBIDDEN`. Hiding buttons in the admin UI is
not a substitute.

Better Auth's `createUser` applies `body.role ?? body.data.role`. The hook
must read the same pair; checking only the top-level `role` lets a crafted
`data.role: "super_admin"` through. `/admin/update-user` can also write
`role` and `banned`, so the hook treats those fields as set-role / ban /
unban.

`canAdminister` is a pure function in `src/lib/auth-hierarchy.ts` so the UI
can hide the same actions the hook would reject.

A SQL data migration promotes the earliest `users.created_at` row to
`super_admin` when no such row exists, so instances that ran setup before
this rule still have exactly one super admin.

## What is wrapped, and what is not

Sign-in, sign-out, get-session, password change, and `/api/auth/admin/*` are
Better Auth's catch-all. They keep the library's error shape.

Project-owned endpoints (`/api/setup`, `/api/registration`, `/api/instance`,
`/api/admin/settings`) use `withErrorHandling` and
`{ error: { code, messageKey, params?, details? } }`.

## Headerless `createUser`

`auth.api.createUser({ body })` with **no `headers` and no `request`** skips
the admin plugin's permission check. That is load-bearing for first-run
setup.

Only `setup.service.ts` and `registration.service.ts` may call `createUser`
without headers, and each must run its own gate first (zero users, and
`allow_registration`, respectively). Never proxy admin mutations through a
headerless server call — the browser talks to `/api/auth/admin/*` directly.

The hierarchy hook also skips when there is no session, so those two
trusted calls are not blocked. Setup passes `role: "super_admin"`; that is
the only path that may.

## Cookie cache stays off

Do not enable `session.cookieCache`. Ban immediacy depends on session rows
being deleted; a cached cookie would keep authorizing the banned user.

## Disabled public sign-up

`disabledPaths: ["/sign-up/email"]` makes `POST /api/auth/sign-up/email` a 404
at the transport layer. Server-side `auth.api.*` calls are unaffected, which
is how gated registration still creates users.

---

## Scenario: adding a Better Auth plugin

**Scope / Trigger**: any new Better Auth plugin (2FA, passkeys, SSO, …). It
touches the DB schema, a cross-layer request/response contract, and infra
wiring, so it needs the full treatment below.

### Signatures

Four coordinated edits, in this order — registering the plugin before its
table exists makes every plugin endpoint fail:

1. `src/server/db/schema/auth.ts` — mirror the plugin's declared schema
   exactly, plus the `id` column the adapter fills from
   `advanced.database.generateId`; export the table from
   `src/server/db/schema/index.ts`. Schema files must not import `server-only`.
2. `pnpm db:generate` — commit the generated migration in the same commit as
   the schema.
3. `src/server/auth/index.ts` — add the plugin to `plugins` **and** map its
   model to the table in the `drizzleAdapter` `schema` object
   (`verification: verifications`, `twoFactor: twoFactors`).
4. `src/lib/auth-client.ts` — add the matching client plugin.

Do not create route files for the plugin's endpoints: the catch-all at
`src/app/api/auth/[...all]/route.ts` already serves them.

```ts
// src/server/auth/index.ts — server side
import { twoFactor } from "better-auth/plugins";
plugins: [/* … */ roleHierarchy(), twoFactor({ issuer: "Pika chat" }), nextCookies()]
schema: { /* … */ verification: verifications, twoFactor: twoFactors }

// src/lib/auth-client.ts — client side
plugins: [usernameClient(), adminClient(), twoFactorClient()]
```

### Contracts

Plugin endpoints are Better Auth's, so they keep the library's error shape and
are **not** wrapped in `withErrorHandling`. `apiErrorMessage(error, tErrors,
fallbackKey)` finds no `messageKey` on them, so they always resolve to the
caller's fallback key unless the component branches on `error.code` first.

Enrollment/secret-bearing output is the one thing to police: mirror the
plugin's `returned: false` fields and never `select` them into a response.
Better Auth encrypts them at rest; an added `created_at` the adapter never
writes would silently lie, so do not add bookkeeping columns the plugin does
not know about.

### Validation & Error Matrix (TOTP, the instance currently wired)

| Condition | Behaviour |
|---|---|
| `enable` without a session | 401 |
| `enable` with a wrong password | 400 `INVALID_PASSWORD` |
| `enable` on a first-time account | row `verified = false`, `users.two_factor_enabled` **unchanged** |
| `verify-totp` before confirmation succeeds | `verified → true`, `two_factor_enabled → true`, session rotated |
| `verify-totp` with a wrong code | 401 `INVALID_CODE` |
| `verify-backup-code` with a consumed/old code | 401 `INVALID_BACKUP_CODE` |
| `disable` with a wrong password (session required) | 400 `INVALID_PASSWORD` |
| Any `/two-factor/*` request in production | limited to 3 per 10 s |

### Good / Base / Bad Cases

- Good: password → `enable` → render QR from `totpURI` → `verify-totp` →
  reveal the held backup codes → revoke other sessions.
- Base: user has no 2FA on — sign-in stays single-step, no cookie, no
  challenge.
- Bad: revealing backup codes straight from `enable`, or assuming
  `two_factor_enabled` flipped there. Abandoning setup must not strand the
  user, and `enable` is not proof of enrollment.

### Tests Required

- Integration (real DB): unverified row + flag still false after `enable` and a
  still-single-step sign-in; flag flip only on a valid code; the challenge
  response carrying `twoFactorRedirect`/`twoFactorMethods` and **no** session;
  backup code accepted and invalidated by regeneration; non-leakage assertion
  that the session payload contains neither the secret nor `backupCodes`.
- The TOTP code in tests is computed with `node:crypto` (RFC 6238, HMAC-SHA1,
  30 s window) from the secret parsed out of `totpURI` — do not add a test
  dependency or reach into Better Auth's transitive packages.
- Unit: the cookie-name suffix matcher, the TOTP-vs-backup-code shape
  predicate, and the request-body schema (prefix + length cap).

### Wrong vs Correct

```ts
// Wrong: the challenge cookie has a `__Secure-` prefix on https, so equality
// silently redirects every real challenge back to sign-in.
name === "two_factor";

// Correct
name.endsWith("two_factor");
```

```ts
// Wrong: `enable` returns codes before the secret is verified.
const { backupCodes } = await authClient.twoFactor.enable({ password });
setCodes(backupCodes);

// Correct: hold them, reveal only after `verifyTotp` succeeds.
setHeldCodes(backupCodes);
await authClient.twoFactor.verifyTotp({ code });
setCodes(heldCodes);
```

### Known limitation (documented, not a bug)

The challenge is bound to a signed cookie — neither the sign-in body nor
`/two-factor/verify-totp` accepts a pending-user identifier. A pure
`Authorization: Bearer` client with no cookie jar cannot complete the second
step. Browser flows and bearer access **after** login are unaffected. Fixing
this would mean forking the plugin, so treat it as a constraint when designing
headless clients.
