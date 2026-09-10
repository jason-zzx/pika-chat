# Design — optional TOTP 2FA

## Approach

Enable better-auth's built-in `twoFactor` plugin and build the UI around it. No custom TOTP
crypto, no custom session handling, no re-implementation of the challenge state machine.
The work is: schema + migration, two plugin registrations, one project-owned QR Route Handler,
one settings card, one challenge page, and one branch in the sign-in form.

Data flow and endpoint contracts are documented in `research/better-auth-two-factor.md`.

## Boundaries

| Layer | Change | File |
|---|---|---|
| DB schema | `users.twoFactorEnabled` + new `two_factors` table | `src/server/db/schema/auth.ts`, barrel `src/server/db/schema/index.ts` |
| Migration | generated `0013_*` | `pnpm db:generate` |
| Server auth config | register `twoFactor()`, map `twoFactor` → `twoFactors` in the adapter | `src/server/auth/index.ts` |
| Client auth config | register `twoFactorClient()` | `src/lib/auth-client.ts` |
| HTTP (project-owned) | `POST /api/account/2fa/qrcode` | `src/app/api/account/2fa/qrcode/route.ts` |
| Validation | shared Zod schema for the QR request | `src/lib/schemas/two-factor.ts` |
| Settings page (RSC) | read `twoFactorEnabled`, render the card | `src/app/(app)/settings/account/page.tsx` |
| Settings UI (client leaf) | enrollment / disable / regenerate | `src/components/account/TwoFactorCard.tsx` |
| Challenge page (RSC) | gate on the pending challenge, render the form | `src/app/(auth)/two-factor/page.tsx` |
| Challenge UI (client leaf) | code entry | `src/components/auth/TwoFactorForm.tsx` |
| Sign-in (client leaf) | branch to the challenge | `src/components/auth/SignInForm.tsx` |
| i18n | `Auth.twoFactor.*`, `Account.twoFactor.*`, `Errors.actions.*`, `Errors.auth.*` | `messages/en.json`, `messages/zh-CN.json` |

Every other 2FA endpoint (`/two-factor/enable`, `verify-totp`, `verify-backup-code`,
`generate-backup-codes`, `disable`) is better-auth's, served by the existing catch-all. Per
`.trellis/spec/backend/auth-guidelines.md` those keep better-auth's error shape and are **not**
wrapped in `withErrorHandling`.

## Data model

```ts
// src/server/db/schema/auth.ts — added to `users`
twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),

export const twoFactors = pgTable(
  "two_factors",
  {
    id: text("id").primaryKey(),               // supplied by advanced.database.generateId
    secret: text("secret").notNull(),           // encrypted by better-auth; never returned
    backupCodes: text("backup_codes").notNull(),// encrypted by better-auth; never returned
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamptz("locked_until"),
  },
  (table) => [
    index("two_factors_user_id_idx").on(table.userId),
    index("two_factors_secret_idx").on(table.secret),
  ],
);
```

Field set mirrors the plugin's declared schema exactly (plus `id`), so the adapter can read and
write it without translation. `verified` defaults to `true` to match the plugin's own default.
Exported through `src/server/db/schema/index.ts` and mapped in the adapter as
`twoFactor: twoFactors`, alongside the existing `verification: verifications` entry.

Migration is purely additive: one nullable-free boolean column with a default, one new table.
`drizzle-kit generate` must produce `0013_*` and it ships in the same commit as the schema
(`.trellis/spec/backend/database-guidelines.md`).

## Enrollment flow

```
[TwoFactorCard] --(password)--> authClient.twoFactor.enable({ password, issuer })
        <-- { totpURI, backupCodes[] }        (secret stored, verified=false, user flag still false)
[TwoFactorCard] --(totpURI)-->   POST /api/account/2fa/qrcode
        <-- { dataUrl }                       (server renders the QR, `qrcode` runs server-side)
[TwoFactorCard] --(6-digit)-->  authClient.twoFactor.verifyTotp({ code })
        <-- success -> verified=true, twoFactorEnabled=true, session rotated by the server
[TwoFactorCard] --> authClient.revokeOtherSessions()
[TwoFactorCard] shows the backup codes held from step 1 + the loss warning
```

Why the QR needs a Route Handler: `totpURI` only exists after the client calls `enable`, so the
Server Component cannot pre-render it. Alternatives considered and rejected — client-side QR
library (ships the encoder to the browser even though `qrcode` is Node-oriented), and a Server
Action (spec requires an HTTP Route Handler for every capability).

Why the backup codes are held in component state: `enable` returns them in plaintext before the
secret is confirmed, but they must only be displayed after confirmation succeeds.

Abandoning enrollment anywhere before `verifyTotp` leaves `users.twoFactorEnabled === false`, so
no challenge is ever produced for a half-finished setup (AC10).

## Sign-in flow

```
[SignInForm] --(credentials)--> signIn.email | signIn.username
        <-- { twoFactorRedirect: true, twoFactorMethods }
[SignInForm] router.push("/two-factor") + router.refresh()
[/two-factor RSC] gate: redirect("/sign-in") when no `two_factor` cookie is present
[TwoFactorForm] --(code)--> verifyTotp  when /^\d{6}$/
                         -> verifyBackupCode otherwise
        <-- success -> router.push("/") + router.refresh()
```

`twoFactorClient()` is registered **without** `twoFactorPage` and without `onTwoFactorRedirect`,
so the library's own redirect hook stays inert and `SignInForm` keeps control of navigation —
this avoids the library's `window.location.href` full reload and needs no module-level router hack.

The RSC gate reads cookies and matches any name ending in `two_factor`, because better-auth
prefixes secure cookies with `__Secure-` when `BETTER_AUTH_URL` is https. Presence is used only
to decide whether a challenge was issued; authorization is still decided server-side by
`verify-two-factor`, so a forged cookie gains nothing.

Code dispatch is format-based rather than a UI toggle: TOTP codes are exactly 6 digits, backup
codes are always `XXXXX-XXXXX` (11 chars with a hyphen, `backup-codes/index.mjs:14`), so the two
never collide. Backed by a unit test.

## Error handling and copy

better-auth errors do not carry our `{ error: { messageKey } }` envelope, so
`apiErrorMessage(error, tErrors, fallbackKey)` resolves them to the caller-supplied fallback.
Components branch on `result.error.code` **only** for `INVALID_CODE` / `INVALID_BACKUP_CODE`,
which map to one specific "code not accepted" message; everything else uses the action fallback.

New copy:

- `Account.twoFactor.*` — card title, enable/disable buttons, password prompt, QR caption,
  manual-secret label, confirmation prompt, backup-codes block, loss warning, regenerate.
- `Auth.twoFactor.*` — challenge page title, code label, submit, backup-code hint.
- `Errors.actions.*` — `enableTwoFactor`, `disableTwoFactor`, `verifyTwoFactor`,
  `generateBackupCodes`, `loadQrCode`.
- `Errors.auth.invalidTwoFactorCode` — the specific "code not accepted" message.

Both `messages/en.json` and `messages/zh-CN.json` change together; the i18n spec is enforced at
`error` level with no excludes.

## Security notes

- `secret` and `backupCodes` are `returned: false` in the plugin schema, and better-auth's user
  output therefore never includes them. Our QR Route Handler takes only an `otpauth://` URI and
  returns only an image data URL — it has no access to stored secrets.
- The QR Route Handler is the one new input surface. It is guarded by `requireActor` and its body
  is validated: must start with `otpauth://totp/`, must be under a length cap. Anything else is a
  400 `VALIDATION_FAILED`. Accepted residual: it can render a QR for any well-formed otpauth URI
  the caller supplies, which is a negligible abuse surface for an authenticated endpoint.
- Sessions created before 2FA was enabled are revoked at enable time (R12), because they would
  otherwise keep working without the second factor.
- The challenge is cookie-bound (documented in the research file). Browser flows and all existing
  bearer access after login are unaffected; the only gap is a hypothetical client that insists on
  bearer-only with no cookie jar, which cannot complete the challenge step.
- Challenge brute-force resistance rests on the per-user `failedVerificationCount` /
  `lockedUntil` columns, which apply in every environment. better-auth's 3-per-10s rule for
  `/two-factor/*` is active only when `NODE_ENV === "production"`, because the app sets no
  `rateLimit` option; that is acceptable for a self-hosted single-instance deployment but is not
  the load-bearing control.

## Trade-offs

| Choice | Alternative | Why this one |
|---|---|---|
| better-auth plugin | hand-rolled TOTP | Already installed; no new crypto dependency; battle-tested state machine |
| Dedicated `/two-factor` page | inline second step in `SignInForm` | User's choice; survives reload; cleaner if a second method is added later |
| Server-rendered QR via Route Handler | client QR library, Server Action | Keeps the encoder off the client bundle; Route Handler satisfies the spec |
| Password-only disable | also require a TOTP code | `/two-factor/disable` needs an authenticated session first, so password alone cannot reach it |
| Show codes once + regenerate | reveal remaining codes later | `viewBackupCodes` has no HTTP endpoint; regenerate already covers loss |
| Revoke other sessions on enable | leave them | Pre-2FA sessions would bypass the second factor |

## Rollout and rollback

- Rollout: feature is opt-in and off by default; existing users see no change until they enroll.
- Rollback: the migration is additive. Reverting the code leaves an inert column and table.
  Removing them later is a separate destructive migration, per the database guidelines.
- Ordering constraint: the migration must land in the same commit as the schema change, and the
  plugin must not be registered before the table exists — otherwise every 2FA query fails.
