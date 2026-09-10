# Optional TOTP two-factor authentication for user accounts

## Goal

Let any user opt in to TOTP-based two-factor authentication on their own account. Once enabled,
signing in requires a second step: a 6-digit code from an authenticator app, or a backup code.
Users who do nothing keep today's single-step password login — 2FA is strictly opt-in and is
never enforced instance-wide.

User value: in a self-hosted deployment, accounts stay protected even if a password leaks.

## Background

Auth in this app is entirely driven by `better-auth@1.7.2` through one config object at
`src/server/auth/index.ts:17`, and every auth endpoint is served by the catch-all at
`src/app/api/auth/[...all]/route.ts:5`. better-auth already ships a complete TOTP 2FA plugin, so
this feature is configuration plus UI, not a new auth implementation.

Verified facts that shape the design (full detail in `research/better-auth-two-factor.md`):

- The plugin covers `/sign-in/email` and `/sign-in/username`, so this app's primary login path is covered.
- Enrollment is a two-step state machine: `enable` stores an unverified secret and does **not**
  set `users.twoFactorEnabled`; only a successful `verifyTotp` flips both `verified` and
  `twoFactorEnabled`. Abandoning setup therefore never strands a user behind a challenge.
- The sign-in challenge is bound to a signed `two_factor` cookie, not to anything in the response
  body. Browser clients are unaffected; a future pure-`Authorization: Bearer` client would have to
  replay that cookie to finish the challenge. Bearer access after login is unchanged.
- `viewBackupCodes` is server-only (no HTTP endpoint), so "show my remaining codes" is not a
  free capability.
- There is no email/SMTP infrastructure in the project at all, so there is no self-service
  recovery channel of any kind.
- There is no 2FA field in the database today and no otp/totp/qrcode dependency.

## Requirements

### Enrollment

- **R1** A user starts enrollment from the account settings page by entering their password.
- **R2** On success the UI shows an `otpauth://` QR code **and** the same secret as copyable
  text, so users who cannot scan a screen can still enroll.
- **R3** The user confirms with a 6-digit code. 2FA becomes active only after that code is accepted.
- **R4** After confirmation the UI shows the backup codes once, together with an explicit warning
  that losing both the device and the codes means permanent loss of access.

### Sign-in

- **R5** A 2FA-enabled user who submits correct credentials is **not** signed in; they land on a
  dedicated `/two-factor` page asking for a code.
- **R6** A backup code is accepted in place of a TOTP code.
- **R7** Only after the second step succeeds is the user signed in and sent to the app.
- **R8** Users without 2FA keep today's single-step login, unchanged.
- **R9** Reaching `/two-factor` with no pending challenge sends the user back to `/sign-in`.

### Management

- **R10** A 2FA-enabled user can turn 2FA off from the same settings UI by entering their password.
- **R11** A user can regenerate backup codes; the new set replaces the old one immediately.
- **R12** Successfully enabling 2FA revokes the user's other sessions, matching the existing
  behaviour when a password is changed (`src/components/account/ChangePasswordForm.tsx:32`).

### Cross-cutting

- **R13** All new UI copy is added to both `messages/en.json` and `messages/zh-CN.json`.
- **R14** TOTP secrets and stored backup codes must never reach a client response.

## Acceptance criteria

- [ ] AC1 A user can enable 2FA: password accepted → QR + copyable secret shown → 6-digit code
      accepted → UI reports 2FA active and displays backup codes with the loss warning.
- [ ] AC2 Signing in as that user in a fresh browser session does not reach the app after correct
      credentials; it lands on `/two-factor`, and only a valid code completes the sign-in.
- [ ] AC3 A backup code issued at enrollment is accepted at the challenge step.
- [ ] AC4 A user without 2FA signs in exactly as before, with no second step (regression).
- [ ] AC5 Visiting `/two-factor` with no pending challenge redirects to `/sign-in`.
- [ ] AC6 The settings UI reflects the current state after a page reload (enabled vs not enabled).
- [ ] AC7 A user can disable 2FA with their password; afterwards sign-in is single-step again.
- [ ] AC8 A user can regenerate backup codes; the previously displayed set stops working and the
      new set works.
- [ ] AC9 After enabling, sessions on other devices are signed out; the current session stays alive.
- [ ] AC10 Abandoning enrollment after seeing the QR does not create a sign-in challenge
      (regression guard for the half-setup state).
- [ ] AC11 `POST /api/account/2fa/qrcode` rejects an unauthenticated caller (401) and rejects
      input that is not an `otpauth://totp/…` URI or that exceeds the length cap (400).
- [ ] AC12 All new copy renders in both English and Simplified Chinese.
- [ ] AC13 `pnpm lint && pnpm typecheck && pnpm test` pass.

## Out of scope

- Email/SMS OTP — TOTP only. `otpOptions.sendOTP` is not configured, so the plugin exposes no OTP method.
- "Trust this device" (remember for 30 days) — not enabled.
- Admin-side reset of another user's 2FA — no UI, no endpoint.
- Instance-wide mandatory 2FA.
- Any account-recovery flow beyond backup codes. Accepted consequence: a user who loses both the
  device and all backup codes is permanently locked out; the enrollment UI warns about this (R4).

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Library vs custom | better-auth `twoFactor` plugin | Already installed; TOTP needs no new runtime dependency |
| Methods | TOTP only | No email/SMS infrastructure exists |
| Challenge UI | Dedicated `/two-factor` page | User's choice; survives a page reload |
| Disable proof | Password only | `/two-factor/disable` requires an authenticated session first, so a password alone is not enough to reach it |
| Backup codes | Shown once at generation, regenerable | `viewBackupCodes` has no HTTP endpoint; regenerating already covers "I lost them" |
| Sessions on enable | Revoke others | Matches the existing password-change behaviour; pre-2FA sessions would otherwise bypass the second factor |
| Lockout risk | Accepted with a UI warning | No admin reset and no email recovery channel |
| QR rendering | Server-side `qrcode` via a project-owned Route Handler | The URI only exists client-side at runtime, so it cannot be pre-rendered in the Server Component |
