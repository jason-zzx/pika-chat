# better-auth 1.7.2 `twoFactor` plugin — verified behaviour

All line references are to `node_modules/better-auth/dist/plugins/two-factor/**` at the
version pinned in this repo (better-auth 1.7.2). Verified by reading the shipped source,
not from docs.

## Exports

- Server: `require("better-auth/plugins").twoFactor` → function (confirmed at runtime).
- Client: `require("better-auth/client/plugins").twoFactorClient` → function (confirmed at runtime).
- No new runtime dependency for TOTP: the plugin reuses better-auth's `@noble/hashes` / `@noble/ciphers`.

## Endpoints (client `pathMethods`)

`/two-factor/enable`, `/two-factor/disable`, `/two-factor/get-totp-uri`,
`/two-factor/verify-totp`, `/two-factor/send-otp`, `/two-factor/verify-otp`,
`/two-factor/generate-backup-codes`, `/two-factor/verify-backup-code`.

All are served automatically by the existing catch-all `src/app/api/auth/[...all]/route.ts`
once the plugin is registered. No new route file is needed for these.

## Storage schema the adapter expects

`schema.mjs`:

- `user.twoFactorEnabled` — boolean, default false, `input: false` (not user-writable, still returned).
- `twoFactor` model: `secret` (string, required, `returned: false`, indexed), `backupCodes`
  (string, required, `returned: false`), `userId` (FK → user.id, indexed), `verified`
  (boolean, default true), `failedVerificationCount` (number, default 0), `lockedUntil` (date).

`secret` and `backupCodes` are marked `returned: false`, so better-auth's own user/session
output never exposes them. Any custom query must keep explicit `.select()` projections.

## Enrollment is a two-step state machine (important)

`index.mjs:106-175` (`enableTwoFactor`):

1. Requires `password` unless `allowPasswordless` is set (we leave it unset).
2. Generates a 32-char secret, encrypts it, and **generates backup codes eagerly**.
3. Upserts the `twoFactor` row with `verified: existing?.verified === true || !!skipVerificationOnEnable`
   → for a first-time enable, **`verified: false`**.
4. For `method: "totp"` **without `skipVerificationOnEnable`, `users.twoFactorEnabled` is NOT set.**
   It is only set for `method: "otp"` or when `skipVerificationOnEnable` is true.
5. Returns `{ method: "totp", totpURI, backupCodes: string[] }` — backup codes in **plaintext**.

`totp/index.mjs:200-222` (`verifyTOTP`) closes the loop:

- If `twoFactor.verified !== true` this is the **setup-confirmation** path: it sets
  `users.twoFactorEnabled = true`, sets `verified: true`, and **rotates the session cookie**
  (creates a new session, deletes the old one).
- If `verified === true` this is the **sign-in challenge** path.

Consequences we rely on:

- **Abandoning enrollment is safe.** `twoFactorEnabled` stays false until a code is confirmed,
  so a half-finished setup never produces a sign-in challenge. The card simply reads as "not enabled".
- **Backup codes must be shown only after confirmation succeeds**, even though `enable` returns
  them in step 1 — the client has to hold them in state across the confirm call.
- Re-running `enable` overwrites the row (`existingTwoFactor` branch) with a fresh secret while
  preserving `verified` if it was already true.

## Sign-in challenge

`index.mjs:243-327`, after-hook matching exactly `/sign-in/email`, `/sign-in/username`,
`/sign-in/phone-number`. Our username login is covered.

On a 2FA-enabled account it:

1. Deletes the session the credential handler just created and calls `setNewSession(null)`
   (`index.mjs:276-278`). Any hook reading `ctx.context.newSession` after a sign-in must
   null-check it. Our `roleHierarchy` hook only matches `/admin/*` paths, so it is unaffected.
2. Writes a `2fa-<random>` row into `verifications` (10 min default `twoFactorCookieMaxAge`).
3. Sets a **signed `two_factor` cookie** (name from `constant.mjs`: `TWO_FACTOR_COOKIE_NAME = "two_factor"`).
4. Returns `{ twoFactorRedirect: true, twoFactorMethods: string[] }`.
   `totp` appears only when the user's row has `verified !== false`; `otp` appears only when
   `otpOptions.sendOTP` is configured (we do not configure it → TOTP only).

`verify-two-factor.mjs:17-24` resolves step 2:

- `getSessionFromCtx` → no session exists → falls back to the signed `two_factor` cookie →
  `findVerificationValue` → `findUserById`.
- No cookie ⇒ `INVALID_TWO_FACTOR_COOKIE`.

**The pending-user identifier is only ever transmitted as a cookie — the step-1 response body
does not contain it, and `/two-factor/verify-totp` accepts only `{ code, trustDevice? }`.**
Therefore a client that carries only `Authorization: Bearer` and no cookies cannot complete the
challenge. Browser clients are unaffected. After the challenge completes, bearer access is normal.

## Backup codes

- Generated 10 at a time, format `${5 chars}-${5 chars}` from `[a-z0-9A-Z]`
  (`backup-codes/index.mjs:14`) → e.g. `aB3dE-7xK9p`, always 11 chars with a hyphen.
- Stored encrypted (`storeBackupCodes: "encrypted"` by default); the plaintext set is returned
  only by `enable` and by `generate-backup-codes`.
- `POST /two-factor/generate-backup-codes` body `{ password }` → `{ status, backupCodes: string[] }`
  and invalidates the previous set.
- `viewBackupCodes` is `createAuthEndpoint.serverOnly` — **no HTTP endpoint**. Exposing "show my
  remaining codes" would require a project-owned Route Handler calling `auth.api.viewBackupCodes`.

## Disable

`index.mjs:191-194`: `/two-factor/disable` uses `sensitiveSessionMiddleware` and requires
`password`. Because an authenticated session is required first, an attacker holding only the
password cannot reach it (login itself would demand the second factor) — so requiring a TOTP
code in addition to the password adds little. We keep password-only.

## Client plugin behaviour

`client.mjs:27-36`: on any response whose body has `twoFactorRedirect: true`, the client plugin
either calls `options.onTwoFactorRedirect({ twoFactorMethods })` or, if `options.twoFactorPage`
is set, does `window.location.href = twoFactorPage`. If neither option is passed it does nothing,
which lets the calling component handle the branch itself.

## Rate limiting and lockout

`index.mjs:337` declares a per-path rule of **3 requests per 10 seconds** for every
`/two-factor/*` path. However the limiter itself is opt-in by environment:
`create-context.mjs:171` resolves `rateLimit.enabled` to `options.rateLimit?.enabled ?? isProduction`,
and this app sets no `rateLimit` option. So the rule is **active only when `NODE_ENV === "production"`**
and is inert in dev and in tests — integration tests do not need to throttle themselves.

Independent of that, brute-force protection is also persisted per user in `two_factors`:
`failedVerificationCount` and `lockedUntil`, enforced by `assertTwoFactorNotLocked` /
`recordTwoFactorFailure` in `verify-two-factor.mjs`. That works in every environment.

## Error codes available for mapping

`TOTP_NOT_ENABLED`, `TOTP_NOT_CONFIGURED`, `OTP_NOT_ENABLED`, `OTP_HAS_EXPIRED`,
`TWO_FACTOR_NOT_ENABLED`, `BACKUP_CODES_NOT_ENABLED`, `INVALID_BACKUP_CODE`, `INVALID_CODE`,
`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`, `ACCOUNT_TEMPORARILY_LOCKED`, `INVALID_TWO_FACTOR_COOKIE`.

These are better-auth errors, not our `{ error: { messageKey } }` envelope, so
`apiErrorMessage()` resolves them to the caller's fallback key unless the component branches on
`result.error.code` first.

## Spec files touched by this task

- `.trellis/spec/backend/index.md`, `auth-guidelines.md`, `database-guidelines.md`,
  `directory-structure.md`, `error-handling.md`, `quality-guidelines.md`
- `.trellis/spec/frontend/index.md`, `component-guidelines.md`, `i18n.md`,
  `quality-guidelines.md`, `type-safety.md`, `state-management.md`, `hook-guidelines.md`
