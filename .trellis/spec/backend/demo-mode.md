# Demo Mode Contract

> Env-gated public demo: per-device anonymous guests, operator-inherited
> models/search, daily usage counters, 7-day inactive-guest purge. Landed with
> `11-13-demo-site-mode`.

## Scenario: touching guests, demo counters, or anything gated by `DEMO_MODE`

### 1. Scope / Trigger

Any change to `DEMO_MODE`/`DEMO_*`/`CLIENT_IP_HEADER` env, the anonymous
plugin wiring, `actor.isGuest` branches, `demo_usage_counters`, or the guest
purge. Crosses env → auth → services → background turn → UI.

**Private feature**: demo mode exists only for this project's own demo
deployment. Do **not** document it in `README*`, `.env.example`, or changelogs;
this spec is its only documentation.

Operator notes: the proxy must overwrite (not append) `CLIENT_IP_HEADER` and
the app must not be reachable directly (nginx `proxy_set_header X-Real-IP
$remote_addr;` → `x-real-ip`; Caddy `header_up X-Real-IP {remote_host}`;
Cloudflare-locked origin → `cf-connecting-ip`). Models = shared, enabled
providers; search credentials and title/compression/translation preferences
come from the `super_admin` account. Operator signs in at `/sign-in?admin=1`.

**Gating rule** — keep both halves:

- Process-level code (plugin registration, auth hooks, IP header config,
  purge scheduling, sign-in UI) checks `isDemoMode()`.
- Request/turn code checks `actor.isGuest`. Guests can only exist when the
  anonymous plugin is registered, so without the flag every guest branch is
  inert. Do **not** add `isDemoMode()` checks inside request paths.

### 2. Signatures

- Env (`src/server/env.ts`, defaults in the schema):
  `DEMO_MODE` (booleanFlag), `DEMO_DAILY_MODEL_CALLS`=10,
  `DEMO_DAILY_SEARCH_CALLS`=10 (searchWeb + fetchPage combined),
  `DEMO_DAILY_UPLOADS`=5, `DEMO_GUEST_STORAGE_MB`=20,
  `DEMO_GUESTS_PER_IP_DAILY`=5, `DEMO_GLOBAL_DAILY_MODEL_CALLS`=2000,
  `DEMO_MAX_OUTPUT_TOKENS`=16384, `CLIENT_IP_HEADER` (required in demo —
  boot fails in `src/instrumentation.ts`). `isDemoMode()`.
- DB: `users.is_anonymous boolean not null default false`;
  `demo_usage_counters(subject, day date, kind, count)` PK
  `(subject, day, kind)`. `subject` = userId | `ip:<addr>` | `global`;
  `kind` = `model | search | upload | guest`.
- Service: `consumeDemoQuota({ subject, kind, limit, day?, tx? }) → boolean`
  (atomic `insert … on conflict … do update … where count < limit
  returning`); `consumeGuestModelTurnQuota(userId, tx)` (guest + global,
  throws); `getGuestUsage(userId)`; `purgeInactiveGuests(now?)`
  (`demo-cleanup.service.ts`); `resolveOperatorId() → string` (the
  `super_admin`; throws if absent — setup guarantees it before any guest).
- Auth: `createAuthInstance()`; `Actor.isGuest?`; `requireMember(headers)`
  (403 `auth.guestForbidden`). Background turns: `ChatGenerationInput.actorIsGuest`
  captured at admission → `generationActor(row).isGuest`.
- Route: `GET /api/demo/usage` → `{ model, search, upload: { used, limit } }`;
  404 `demo.notFound` when not demo or not guest.
- Instance: `GET /api/instance` always carries `demo: boolean`;
  `allowRegistration` is forced false in demo.

### 3. Contracts

| Concern | Rule |
|---|---|
| Guest creation | `POST /api/auth/sign-in/anonymous`; `databaseHooks.user.create.before` fills `username` (`users.username` is NOT NULL, the plugin omits it) |
| IP | Read from `CLIENT_IP_HEADER` only (single value, proxy-overwritten). better-auth `getIP` returns null for multi-hop XFF; `trustedProxyHeaders` does not affect client IP |
| Model calls | Counted inside `acceptTurn` tx after the duplicate-receipt return → rollback refunds. Send/regenerate/edit/image count; title/compression/translation do not |
| Concurrency | Guest row `for update` + at most one active generation per guest (409 `demo.busy`) |
| Search/fetch | Both tools consume one `search` counter before the provider call; over limit → tool output `{ error: "limit_reached", attemptedProviders: [] }` |
| Uploads | `uploadFile` (skipped when `skipSizeLimit`, i.e. generated images) and `completeFile` (discards the direct upload before throwing) |
| Storage | `effectiveQuotaBytes` returns `DEMO_GUEST_STORAGE_MB` for guests |
| Output | `resolvedMaxOutputTokens(model, isGuest)` caps at `DEMO_MAX_OUTPUT_TOKENS` |
| Operator inheritance | Guests use the operator's search credentials and non-`chat` model preferences; the pair is still checked against the **guest's** available models (shared only) |
| Retention | Hourly sweep: anonymous, `created_at < now-7d`, no session `updated_at >= now-7d`; batch 100; blobs + file rows + provider refs first, user row only if no file failed; counter rows older than yesterday dropped |

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| `DEMO_MODE` set, `CLIENT_IP_HEADER` unset | boot error |
| `DEMO_MODE` unset | `/api/auth/sign-in/anonymous` 404 |
| IP header missing / invalid / multi-value | better-auth 403 `IP_UNAVAILABLE`, `logger.error` |
| IP over `DEMO_GUESTS_PER_IP_DAILY` | 429 `GUEST_IP_LIMIT` (existing guest session skips the counter) |
| Guest on `/update-user`, `/change-password`, `/change-email`, `/delete-user`, `/revoke-*`, `/list-sessions`, `/list-accounts`, `/unlink-account`, `/two-factor/*` | 403 |
| Guest on providers/*, search-providers/*, account/2fa | 403 `auth.guestForbidden` |
| Guest writes non-`chat` model preference slot | 403 `auth.guestForbidden` |
| Guest over model / global limit | 429 `demo.modelLimit` / `demo.globalLimit`, nothing persisted |
| Guest with an active generation | 409 `demo.busy` |
| Guest over upload limit | 429 `demo.uploadLimit` |

### 5. Good/Base/Bad Cases

- Good: guest sends 10 messages, 11th gets `demo.modelLimit`; next UTC day works.
- Base: operator lowers a limit mid-day below a stored count → UI shows 0
  remaining (`Math.max(0, …)` in `DemoUsageCard`), consume returns false.
- Bad: operator's title preference points at a private provider → guest
  falls back like any stale preference (must not abort the turn).

### 6. Tests Required

- `demo-usage.service.integration.test.ts`: limit boundary, concurrent
  consume, UTC rollover, tx rollback refunds guest + global.
- `demo-mode.integration.test.ts`: anonymous sign-in gets username, IP cap,
  missing-IP reject, guest auth blocks; acceptTurn limit/busy, output cap,
  upload/storage, operator preference fallback.
- `demo-cleanup.service.integration.test.ts`: stale guest + blobs removed,
  active guest and regular user kept, old counters dropped.
- `auth.integration.test.ts`: anonymous endpoint 404 without flag;
  `/api/instance` includes `demo`.
- `env.test.ts`: demo defaults (unset and `""`), boot check.

### 7. Wrong vs Correct

#### Wrong

```ts
// Read-then-write: two concurrent sends both pass the check.
const used = await getCount(userId, "model");
if (used >= limit) throw limitError;
await increment(userId, "model");
```

#### Correct

```ts
// One atomic statement inside the admission tx; rollback refunds.
if (!(await consumeDemoQuota({ subject: userId, kind: "model", limit, tx }))) {
  throw new AppError("RATE_LIMITED", 429, "demo.modelLimit");
}
```

#### Wrong

```ts
// Guest flag lost in the background executor → no counters, no operator creds.
return { userId: row.userId, role: row.input.actorRole };
```

#### Correct

```ts
return { userId: row.userId, role, isGuest: row.input?.actorIsGuest === true };
```
