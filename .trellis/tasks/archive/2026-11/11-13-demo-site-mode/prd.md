# Demo site mode

## Goal

Run a public demo instance of Pika chat: anyone can try it through one
"Enter demo" entry, only with operator-provided models, with bounded daily cost
and bounded data retention. Enabled by `DEMO_MODE=1`; a deployment without it
behaves exactly as today (no guest sign-in, no counters, no cleanup job).

## Background (repo evidence)

Full map with anchors: `research/integration-points.md`.

- All state is server-side (Postgres + S3/disk); generation, search and fetch
  run server-side. Search/fetch go through third-party providers
  (`src/server/ai/search/providers.ts`), so there is no SSRF surface.
- better-auth 1.7.2 ships an `anonymous` plugin, but it creates users without
  `username` while `users.username` is NOT NULL (`src/server/db/schema/auth.ts:21`).
- better-auth `getIP` returns null for multi-hop `X-Forwarded-For` unless an
  IP header is configured; `trustedProxyHeaders` does not affect it.
- Search credentials are per-user only (`search-provider.service.ts:43-50`).
- No usage ledger, no per-user concurrency cap, no last-active column exist;
  `chat_generations` rows are purged ~24h after finishing.
- Data cascades from `users`; attachment blobs and provider file references do not.

## Key decisions

- D1 One public "Enter demo" button; behind it each device gets its own guest
  user (better-auth anonymous), so guests never see each other's data.
- D2 Limits are enforced per guest user. IP is used only to cap guest creation
  per IP per day (cookie-clearing backstop).
- D3 Image generation stays enabled and counts as a model call.
- D4 No daily wipe. Guests inactive for 7 days are deleted with all rows,
  attachment blobs and provider file references.
- D5 Client-local mode (BYOK, local-only history, local limit config) is a
  later phase, out of scope.
- D6 Usage limits reset per UTC calendar day; storage quota is a running total.
- D7 Only user-initiated calls count against the model-call limit: send,
  regenerate/edit, image. Title, auto/manual compression and translation do not
  count; for guests they use the operator's model preferences.
- D8 Guests use the operator's search-provider credentials.
- D9 Guests may choose their default chat model among allowed (shared) models;
  the title/compression/translation slots are fixed by the operator.
- D10 Guests have no sign-out action (it would orphan their data).
- D11 Operator admin signs in at `/sign-in?admin=1`, which shows the normal
  username/password (+2FA) form; the public page shows only "Enter demo".
- D12 Search and fetch share one daily counter.

## Requirements

- R1 Demo entry: in demo mode `/sign-in` shows only "Enter demo", which creates
  a guest session; an existing guest cookie resumes the same guest.
  `/sign-in?admin=1` shows the normal form. Registration is forced off.
- R2 Lockdown: guests get 403 on provider, search-provider, model-preference
  (non-chat slots), 2FA, password/profile/email change, session-revocation
  endpoints; admin/setup are already closed to them. Corresponding settings
  tabs and the sign-out action are hidden for guests.
- R3 Models: guests see only operator-shared providers (existing
  `resolveAvailableModels` behaviour, since guests own no configs).
- R4 Daily per-guest limits (env-configurable): 10 model calls, 10 network
  tool calls (search + fetch combined), 5 uploads; 20 MB storage per guest; single
  file size via existing `FILE_UPLOAD_MAX_MB`. Exceeding a request-path limit
  returns a localized `RATE_LIMITED`/`QUOTA_EXCEEDED` error; exceeding a
  search/fetch limit makes the tool return a "limit reached" result the model
  can relay.
- R5 Backstops: max guest creations per IP per day; global daily model-call
  ceiling across all guests.
- R6 Cost guards for guests: max 16k output tokens per turn; at most one active
  generation per guest.
- R7 Retention: guests with no session activity for 7 days are deleted with all
  data. A banner tells guests about the 7-day retention and not to enter
  sensitive data. Guests see their remaining daily quota.
- R8 Non-demo deployments: no behaviour change; only schema additions
  (defaulted column + new table) are shared.

## Acceptance criteria

- AC1 With `DEMO_MODE` unset, `/api/auth/sign-in/anonymous` is 404, sign-in UI
  is unchanged, no cleanup job runs, and existing tests pass.
- AC2 Two browsers clicking "Enter demo" get different guests and cannot see
  each other's topics/files.
- AC3 A guest calling any R2 endpoint gets 403; settings shows no
  account/providers/search tabs.
- AC4 After N (limit) sends in a UTC day, the next send returns the localized
  limit error without calling the model; next UTC day it succeeds.
- AC5 Search/fetch beyond the limit yields a limit-reached tool result; uploads
  beyond count/storage are rejected.
- AC6 The (K+1)-th guest creation from one IP in a day is rejected; when the
  client IP cannot be determined, guest creation is rejected and logged;
  `DEMO_MODE` without `CLIENT_IP_HEADER` fails at boot.
- AC7 A guest whose last session activity is >7 days old is removed by the
  sweep, including its blobs; active guests and non-guest users are untouched.
- AC8 `/sign-in?admin=1` lets the operator sign in normally.
- AC9 lint, typecheck, unit + integration tests pass.

## Out of scope

- Client-local mode (D5).
- Captcha/Turnstile (revisit if abuse appears).
