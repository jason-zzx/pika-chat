# Implement — optional TOTP 2FA

Read `prd.md` and `design.md` first, and `research/better-auth-two-factor.md` for endpoint
contracts. Spec indexes to load before editing: `.trellis/spec/backend/index.md` and
`.trellis/spec/frontend/index.md`, plus the guideline files they point at.

## Ordered checklist

### 1. Dependency

- [ ] `pnpm add qrcode` and `pnpm add -D @types/qrcode`.
- [ ] Confirm at runtime that `QRCode.toDataURL(uri, { type: "svg" })` returns a
      `data:image/svg+xml;…` URL. If it does not, fall back to
      `QRCode.toString(uri, { type: "svg" })` and build the data URL from the markup.
      Record which one was used in a code comment at the call site.

### 2. Schema and migration (do this before registering the plugin)

- [ ] `src/server/db/schema/auth.ts`: add `twoFactorEnabled` to `users`; add the `twoFactors`
      table exactly as specified in `design.md` (import `integer` from `drizzle-orm/pg-core`).
- [ ] Export `twoFactors` from `src/server/db/schema/index.ts`.
- [ ] Run `pnpm db:generate` and confirm it produced `0013_*` with the column plus the table.
      Do not hand-edit the SQL.
- [ ] **Rollback point**: the migration is additive; reverting the schema file and deleting the
      generated SQL is safe as long as nothing has run against a deployed database.

### 3. Server auth config

- [ ] `src/server/auth/index.ts`: add `twoFactor({ issuer: "Pika chat" })` to `plugins`, and
      `twoFactor: twoFactors` to the adapter `schema` map next to `verification: verifications`.
- [ ] Do not set `otpOptions.sendOTP` (keeps TOTP the only method), `skipVerificationOnEnable`,
      or `trustDeviceMaxAge` (no trust-device UI).

### 4. Client auth config

- [ ] `src/lib/auth-client.ts`: add `twoFactorClient()` to the plugin list. Pass neither
      `twoFactorPage` nor `onTwoFactorRedirect` — `SignInForm` owns navigation.

### 5. Shared pieces

- [ ] `src/lib/schemas/two-factor.ts`: Zod schema for the QR request body — `uri` must start with
      `otpauth://totp/` and stay under a length cap. Name the input type `QrCodeRequest`.
- [ ] `src/lib/two-factor.ts`: `isTotpCode(code)` → `/^\d{6}$/`. Used to decide
      `verifyTotp` vs `verifyBackupCode`.

### 6. QR Route Handler

- [ ] `src/app/api/account/2fa/qrcode/route.ts`: `withErrorHandling` → `requireActor` → parse with
      the Zod schema → render with `qrcode` → `Response.json({ dataUrl })`.
- [ ] Never log or echo the URI itself.

### 7. Settings UI

- [ ] `src/app/(app)/settings/account/page.tsx` (Server Component): read the session with
      `auth.api.getSession({ headers: await headers() })` and pass `twoFactorEnabled` to the card.
      Do not add the flag to `Actor` in `@/lib/auth-hierarchy` — it is shared with the role
      hierarchy and does not need it.
- [ ] `src/components/account/TwoFactorCard.tsx` (`"use client"` leaf), modelled on
      `src/components/account/ChangePasswordForm.tsx`: same `<form>` + `FormData` handling, same
      inline `<p className="text-sm text-destructive">` error pattern, same
      `apiErrorMessage(result.error, tErrors, fallbackKey)` usage.
      States: not enabled → enrolling (QR + manual secret) → enabled.
      - enable: `authClient.twoFactor.enable({ password, issuer })`
      - QR: `fetch("POST", "/api/account/2fa/qrcode")` → `<img src={dataUrl}>`; manual secret via
        `copyTextToClipboard` from `@/lib/clipboard` (never `navigator.clipboard` directly)
      - confirm: `authClient.twoFactor.verifyTotp({ code })`, then
        `authClient.revokeOtherSessions()`
      - regenerate: `authClient.twoFactor.generateBackupCodes({ password })`
      - disable: `authClient.twoFactor.disable({ password })`
      - branch `result.error.code` for `INVALID_CODE` to the specific message; everything else
        uses the action fallback key.
- [ ] Hold the plaintext backup codes from `enable` in state and only reveal them after
      confirmation succeeds, together with the loss warning.

### 8. Challenge page and form

- [ ] `src/app/(auth)/two-factor/page.tsx` (Server Component): read cookies, and if no cookie
      name ends with `two_factor` call `redirect("/sign-in")`. Match on `endsWith` because
      better-auth prefixes secure cookies with `__Secure-`. Render `<TwoFactorForm />`.
      No change to `src/app/(auth)/layout.tsx` — during a challenge there is no session, so its
      existing "already signed in → /" guard does not fire.
- [ ] `src/components/auth/TwoFactorForm.tsx` (`"use client"` leaf): one code input; submit
      `verifyTotp` when `isTotpCode(code)`, otherwise `verifyBackupCode`; on success
      `router.push("/")` + `router.refresh()`. Same error conventions as step 7.

### 9. Sign-in branch

- [ ] `src/components/auth/SignInForm.tsx`: when `result.data?.twoFactorRedirect` is true,
      `router.push("/two-factor")` + `router.refresh()` instead of pushing `/`.
      Existing `src/components/auth/SignInForm.test.tsx` must keep passing — the no-2FA path is
      unchanged.

### 10. i18n

- [ ] Add `Account.twoFactor.*`, `Auth.twoFactor.*`, `Errors.actions.{enableTwoFactor,
      disableTwoFactor,verifyTwoFactor,generateBackupCodes,loadQrCode}`, and
      `Errors.auth.invalidTwoFactorCode` to **both** `messages/en.json` and `messages/zh-CN.json`.
- [ ] Update `Account.description` so it no longer says the page is only about the password.
- [ ] Check `src/i18n/locales.test.ts` / `defaults.test.ts` still pass (they may assert catalog
      parity).

### 11. Tests

- [ ] `src/lib/schemas/two-factor.test.ts` — accept a well-formed `otpauth://totp/…` URI; reject
      other schemes, other otp types, and oversized input.
- [ ] `src/lib/two-factor.test.ts` — `isTotpCode` accepts 6 digits, rejects backup-code shapes and
      anything else.
- [ ] `src/server/auth/two-factor.integration.test.ts` (new, real DB) covering the enrollment
      state machine and the QR route:
      - `enable` stores a secret but leaves `twoFactorEnabled === false` (AC10 half-setup guard);
      - a valid TOTP confirms and flips the flag (AC1);
      - an invalid code is rejected;
      - `disable` returns the user to single-step;
      - regenerate invalidates the old set;
      - `POST /api/account/2fa/qrcode` returns 401 unauthenticated and 400 for a bad URI (AC11);
      - no response contains `secret` or `backupCodes` (R14).
      Compute TOTP codes in the test with `node:crypto` HMAC-SHA1 over a 30-second window and
      parse the secret out of the `totpURI` returned by `enable` — no new test dependency.
      The plugin's 3-per-10s `/two-factor/*` rule only applies when `NODE_ENV === "production"`
      (see `research/better-auth-two-factor.md`), so tests need no throttling; the per-user
      lockout in `two_factors` still applies and is what bounds retries.
- [ ] `src/components/auth/TwoFactorForm.test.tsx` — backup-code shaped input routes to
      `verifyBackupCode`, 6-digit input routes to `verifyTotp`.

### 12. Validation

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test` (integration tests need the `pika_chat_test` database; they fail rather than
      skip when it is unreachable)
- [ ] Smoke: sign in as a user without 2FA (must be single-step), then enroll, sign out, sign in
      again and complete the challenge, then disable.

## Risky files

| File | Risk | Guard |
|---|---|---|
| `src/server/auth/index.ts` | Registering the plugin before the table exists makes every 2FA path fail | Ship migration + schema before this edit |
| `src/server/db/migrations/0013_*` | Additive but committed | Generate, never hand-edit; same commit as the schema |
| `src/components/auth/SignInForm.tsx` | On the login path for every user | Existing `SignInForm.test.tsx` must stay green; keep the no-2FA branch untouched |
| `src/app/(auth)/two-factor/page.tsx` | Cookie-name mismatch (`__Secure-`) would redirect real challenges back to sign-in | Match with `endsWith("two_factor")`; verify over http and, if possible, https |

## Before `task.py start`

- [ ] `prd.md`, `design.md`, `implement.md` reviewed.
- [ ] `implement.jsonl` and `check.jsonl` curated with real spec/research entries.
- [ ] `qrcode` choice confirmed (server-rendered SVG data URL).
