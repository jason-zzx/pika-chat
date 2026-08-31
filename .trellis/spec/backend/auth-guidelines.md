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
`/api/admin/settings`) use `withErrorHandling` and `{ error: { code, message } }`.

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
