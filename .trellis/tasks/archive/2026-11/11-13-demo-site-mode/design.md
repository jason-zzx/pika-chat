# Design: Demo site mode

Anchors refer to `research/integration-points.md`.

## Gating principle

Everything hangs off two facts:

1. `DEMO_MODE` env flag (`src/server/env.ts`, `booleanFlag`).
2. `actor.isGuest` — true only for anonymous users, which can only exist when
   the anonymous plugin is registered, which only happens in demo mode.

Request-path code checks `actor.isGuest`; process-level code (plugin
registration, cleanup job, sign-in UI) checks `DEMO_MODE`. Without the flag,
no guest can exist, so every guest branch is dead code and the sweep does not
schedule the cleanup.

## Config (env, only read when DEMO_MODE)

| Var | Default | Meaning |
|---|---|---|
| `DEMO_MODE` | unset | master switch |
| `DEMO_DAILY_MODEL_CALLS` | 10 | send/regenerate/edit/image per guest per day |
| `DEMO_DAILY_SEARCH_CALLS` | 10 | searchWeb + fetchPage tool calls combined, per guest per day |
| `DEMO_DAILY_UPLOADS` | 5 | file uploads per guest per day |
| `DEMO_GUEST_STORAGE_MB` | 20 | storage quota per guest |
| `DEMO_GUESTS_PER_IP_DAILY` | 5 | guest creations per IP per day |
| `DEMO_GLOBAL_DAILY_MODEL_CALLS` | 2000 | ceiling across all guests |
| `DEMO_MAX_OUTPUT_TOKENS` | 16384 | per-turn output cap for guests |
| `CLIENT_IP_HEADER` | — (required when `DEMO_MODE`; boot fails without it, checked in `instrumentation.ts` like `S3_DIRECT_ACCESS`) | single-value client IP header the proxy overwrites (e.g. `x-real-ip`, `cf-connecting-ip`) → `advanced.ipAddress.ipAddressHeaders` |

Retention is fixed at 7 days (constant, per D4). Single-file size stays
`FILE_UPLOAD_MAX_MB`.

## Schema (one drizzle migration)

- `users.is_anonymous boolean not null default false` (anonymous plugin field).
- `demo_usage_counters(subject text, day date, kind text, count int not null,
  primary key(subject, day, kind))`. `subject` is a userId, `ip:<addr>`, or
  `global`. `kind` ∈ `model | search | upload | guest` (`search` covers both searchWeb and fetchPage).

## Auth

`src/server/auth/index.ts`:
- Register `anonymous({ generateName })` only when `DEMO_MODE`.
- `databaseHooks.user.create.before`: when `isAnonymous`, set
  `username = "guest-" + id-ish random`. Required: column is NOT NULL.
- `hooks.before` (same shape as `hierarchy.ts:110-120`):
  - path `/sign-in/anonymous`: `getIP`; null (header missing on a request)
    → reject + `logger.error` (fail closed); else consume
    `ip:<addr>/guest` counter, reject when over.
  - session is anonymous and path ∈ {`/update-user`, `/change-password`,
    `/change-email`, `/two-factor/*`, `/revoke-session*`,
    `/revoke-other-sessions`} → 403.
- `advanced.ipAddress.ipAddressHeaders = [CLIENT_IP_HEADER]` in demo mode.

`src/server/auth/actor.ts`: `Actor` gains `isGuest` (from
`session.user.isAnonymous`). New `requireMember(headers)` = `requireActor` +
403 `auth.guestForbidden` for guests; swapped in on the R2 app routes
(providers/*, search-providers/*, account/2fa/*).
`account/model-preferences` PATCH: guests may only set the `chat` slot.
`generationActor(row)` (`generation.service.ts:977`) must carry `isGuest`
(join `users.is_anonymous`) because background turns resolve search
credentials and model preferences.

## Operator identity

"Operator" = the `super_admin` created by setup (`setup.service.ts:42`).
`resolveOperatorId()` reads it once per call (no cache needed at demo scale).
Used for:
- `resolveSearchProviderCredentials(actor)`: guest → operator's credentials (D8).
- `resolveModelPreference(actor, purpose)`: guest and purpose ≠ `chat` →
  operator's preference (D7/D9).

## Usage counters

One service `src/server/services/demo-usage.service.ts`:

```sql
insert into demo_usage_counters (subject, day, kind, count)
values ($s, current_date at UTC, $k, 1)
on conflict (subject, day, kind)
do update set count = demo_usage_counters.count + 1
where demo_usage_counters.count < $limit
returning count
```

No row returned ⇒ over limit. Atomic, no read-then-write race. Accepts an
optional tx so it can join `acceptTurn`.

Call sites (guest only):
- Model: inside `acceptTurn` transaction (`generation.service.ts:341`), after
  the duplicate-receipt early return, consume guest `model` then `global
  model`; failure throws `AppError("RATE_LIMITED", 429, "demo.modelLimit")`
  and the tx rollback refunds. Same tx: count active generations for the user;
  ≥1 → 409 `demo.busy` (R6).
- Search/fetch: `search/tool.ts:119` / `:169` `execute` both consume the shared `search` kind before calling
  the provider; over limit returns `{ error: "limit_reached" }` tool output
  (tools already return error outputs instead of throwing). `buildSearchTools`
  gets the actor's userId/isGuest.
- Upload: `uploadFile` (`file.service.ts:296`) and `completeFile` (`:434`)
  consume `upload` for guests (not image outputs, which pass `skipSizeLimit`
  from `image/turn.ts:263` — gate on that path not counting).
- Storage: `effectiveQuotaBytes` (`src/server/files/quota.ts`) returns
  `DEMO_GUEST_STORAGE_MB` for guests.
- Output cap: `resolvedMaxOutputTokens` (`output-budget.ts:3`) takes a guest
  cap → `min(..., DEMO_MAX_OUTPUT_TOKENS)`.

`GET /api/demo/usage` → `{ model, search, upload: { used, limit } }`
for the current guest (404 when not demo / not guest).

## Cleanup

In `generation-runner.ts` `sweepQueued`, at the existing hourly purge cadence
(`PURGE_EVERY_SWEEPS`), when `DEMO_MODE`: `purgeInactiveGuests()`:
1. Select up to 100 users with `is_anonymous` and `created_at < now-7d` and no
   session with `updated_at >= now-7d` (sessions refresh ≤ daily, enough for a
   7-day window).
2. For each: for their files, `storage.delete(key)` +
   `deleteProviderFileReferences(file)` (same order as `deleteFile`,
   `file.service.ts:779-791`); then delete the user row (cascade).
3. Delete `demo_usage_counters` rows with `day < current_date - 1`.

## UI

- `getInstanceState()` / `/api/instance` exposes `demo: boolean`.
- `sign-in/page.tsx`: demo && no `admin=1` → `DemoEntry` button calling
  `authClient.signIn.anonymous()` (`anonymousClient()` added to
  `auth-client.ts`). Sign-up page redirects to sign-in in demo.
- `AppShell`: guest banner (retention + no sensitive data) and a small
  usage card in the sidebar footer fed by `/api/demo/usage`.
- `SettingsNav`: guests hide account/providers/search; models page shows only
  the chat slot. `SidebarUserMenu`: no sign-out for guests.
- New copy in `messages/en.json` and `messages/zh-CN.json` (UI + `Errors.demo.*`,
  `Errors.auth.guestForbidden`).

## Non-demo impact

Shared footprint is the migration only (defaulted column, unused table). Plugin
not registered → anonymous endpoint 404; no guest actors → guest branches
inert; cleanup not scheduled; UI flag false. AC1 verifies this.

## Rollback

Unset `DEMO_MODE`. Code revert + migration down is only needed to remove the
schema footprint.

## Deployment note (README)

The app must only be reachable through the reverse proxy, and the proxy must
overwrite (not append to) `CLIENT_IP_HEADER` with the peer address, otherwise
clients can spoof it. Examples: nginx `proxy_set_header X-Real-IP
$remote_addr;` → `CLIENT_IP_HEADER=x-real-ip`; Caddy `header_up X-Real-IP
{remote_host}`; Cloudflare (origin locked to CF) → `cf-connecting-ip`.
