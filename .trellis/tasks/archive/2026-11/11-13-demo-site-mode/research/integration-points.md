# Research: DEMO_MODE integration points

- **Query**: Map exact integration points for an env-gated DEMO_MODE (auth, UI, guards, model resolution, counting, cleanup, errors, specs)
- **Scope**: internal (+ installed better-auth 1.7.2 sources in node_modules)
- **Date**: 2026-11-13

## 1. Auth

| Location | Excerpt | Demo note |
|---|---|---|
| `src/server/auth/index.ts:50-68` | `plugins: [username(), bearer(), admin({...}), roleHierarchy(), twoFactor(...), nextCookies()]` | Add `anonymous({...})` here (before `nextCookies()`, which must stay last). Import from `better-auth/plugins`. |
| `src/server/auth/index.ts:69-75` | `advanced: { database: { generateId }, trustedProxyHeaders: true }`, `disabledPaths: ["/sign-up/email"]` | No `session`, `rateLimit`, `hooks`, `databaseHooks`, or `advanced.ipAddress` configured today. |
| `src/lib/auth-client.ts:22` | `plugins: [usernameClient(), adminClient(), twoFactorClient()]` | Add `anonymousClient()` for `authClient.signIn.anonymous()`. |
| `src/server/db/schema/auth.ts:14-41` | `users` table; `username: text("username").notNull().unique()` (l.21) | Needs new `is_anonymous boolean default false` column + drizzle migration (`pnpm db:generate`, migrations in `src/server/db/migrations`, latest `0025_steady_sway.sql`). No last-active column exists. |

**anonymous plugin facts** (`node_modules/better-auth/dist/plugins/anonymous/`):
- Options (`types.d.mts`): `emailDomainName` (default `anonymous.placeholder.invalid`), `onLinkAccount`, `disableDeleteAnonymousUser`, `generateName(ctx)`, `generateRandomEmail()`, `schema`.
- Schema adds `user.isAnonymous: boolean, required:false, input:false, defaultValue:false` (`index.d.mts` schema block).
- Endpoints: `POST /sign-in/anonymous`, `POST /delete-anonymous-user` (uses `sensitiveSessionMiddleware`).
- `index.mjs:81` rejects if the current session is already anonymous (`ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY`) -> "resume" = existing cookie is still valid; UI should just redirect when a session exists (AuthLayout already does, see section 2).
- `index.mjs:84-91` calls `internalAdapter.createUser({ email, emailVerified:false, isAnonymous:true, name, createdAt, updatedAt })` — **no `username`**. `users.username` is NOT NULL, and the username plugin's `databaseHooks.user.create.before` (`plugins/username/index.mjs:66-83`) only normalizes a username if present. So an app-level `databaseHooks.user.create.before` (or similar) must supply `username` for anonymous creates, else insert fails.
- `index.mjs:168-210` after-hook on `/sign-in*` / `/sign-up*` handles account linking (deletes anon user unless `disableDeleteAnonymousUser`). Not relevant if guests can never sign in to a real account.
- Role: admin plugin `defaultRole: "user"` (index.ts:54) applies -> guests are `user`.

**Hook to rate-limit guest creation per IP**: global `hooks.before` / plugin `hooks.before` with `matcher: ctx => ctx.path === "/sign-in/anonymous"` and `createAuthMiddleware` (pattern already used in `src/server/auth/hierarchy.ts:110-120`, imports `APIError, createAuthMiddleware, getSessionFromCtx` from `better-auth/api`). `getIP` is exported from `better-auth/api` (`dist/api/index.mjs:216`).
- Alternative built-in: `rateLimit.customRules["/sign-in/anonymous"] = { window, max }` — but default storage is in-memory, `enabled` defaults to production only, window in seconds (`context/create-context.mjs:169-174`). Not daily/persistent.

**IP source**: `@better-auth/core/dist/utils/ip.mjs` `getIP()`: reads `advanced.ipAddress.ipAddressHeaders` (default `["x-forwarded-for"]`); without `trustedProxies` it only accepts a **single-value** header; multi-hop XFF returns null; dev/test fall back to `127.0.0.1`; prod returns `null`. IPv6 normalized to /64. `trustedProxyHeaders: true` (index.ts:73) only affects baseURL/host resolution, NOT client IP. Sessions store it: `internal-adapter.mjs:264` `ipAddress: getIP(headers, options) || ""` -> `sessions.ip_address` (`schema/auth.ts:51`).

**Session defaults** (`context/create-context.mjs:146-148`): `expiresIn` 7d, `updateAge` 1d, `freshAge` 1d. Refresh (`api/routes/session.mjs:172-195`): on getSession when `expiresAt - expiresIn + updateAge <= now`, updates `expiresAt` and `updatedAt` -> `sessions.updated_at` advances at most once per day of activity (usable as day-granular last-activity proxy). Guest whose session expires (7d idle) loses access anyway.

**Actor resolution**: `src/server/auth/actor.ts:29-44` `resolveActor` -> `{ userId, role, name }` from `auth.api.getSession`; `requireActor` l.46, `requireAdmin` l.54 (`auth.adminRequired`). `actorName` (l.19) uses username/email. Actor has no `isAnonymous` today; `Actor` type in `src/lib/auth-hierarchy.ts:3-6`. `generationActor(row)` (`generation.service.ts:977`) rebuilds actor from row for background turns (role only).

## 2. Login / setup UI

| Location | Excerpt | Demo note |
|---|---|---|
| `src/app/(auth)/layout.tsx:14-17` | `if (actor) redirect("/")` | Existing guest cookie -> resumes automatically. |
| `src/app/(auth)/sign-in/page.tsx:43-46,54` | `if (state.needsSetup) redirect("/setup")`; `<SignInForm allowRegistration=...>` | Render "Enter demo" button instead of form in demo mode. needsSetup still applies (operator must create admin first). |
| `src/components/auth/SignInForm.tsx:51-62` | `authClient.signIn.email/username` then `router.push("/")` | Demo button would call `authClient.signIn.anonymous()`; same push/refresh. |
| `src/app/(auth)/setup/page.tsx:69-72` | `if (!state.needsSetup) redirect("/sign-in")` | Setup only reachable while zero users. |
| `src/app/(auth)/sign-up/page.tsx`, `src/components/auth/SignUpForm.tsx` | registration UI | hide/disable in demo. |
| `src/server/services/instance-settings.service.ts:51-60` | `needsSetup: userCount === 0` | Counts ALL users incl. guests; fine as long as admin is created first (guests can't exist before admin because sign-in redirects to setup). |
| `src/app/api/setup/route.ts:7-16` / `src/server/services/setup.service.ts:16-55` | `createFirstAdmin` -> 403 `setup.alreadyCompleted` if any user | Already self-locking once a user exists. |
| `src/app/api/registration/route.ts` / `registration.service.ts:16-30` | gated by `appSettings.allowRegistration` | No auth; demo should force-off. |
| `src/app/api/instance/route.ts` | public `getInstanceState()` | Could carry a `demo` flag to client. |

Operator admin: still signs in via normal credentials; PRD R1 hides that form, so operator needs some path (e.g. a non-linked `/sign-in?operator` or keep the form secondary) — unresolved in PRD.

## 3. Endpoints guests must be blocked from

All app routes are wrapped in `withErrorHandling` (`src/app/api/_lib/with-error-handling.ts`) and call `requireActor`/`requireAdmin` first, so a single `requireNonGuest`/`requireActor` variant check fits at the top line of each handler.

App routes (mutating, all `requireActor` unless noted):
- Providers: `providers/route.ts:15` POST; `providers/[id]/route.ts:20` PATCH, `:31` DELETE; `providers/[id]/models/route.ts:14` POST, `:25` PATCH, `:37` DELETE; `providers/[id]/discover/route.ts:6` POST.
- Search providers: `search-providers/[provider]/route.ts:25` PUT, `:33` DELETE; `search-providers/order/route.ts:6` PATCH.
- Account: `account/2fa/qrcode/route.ts:6` POST; `account/model-preferences/route.ts:15` PATCH (demo: block or allow only operator models); `account/preferences/route.ts:6` PATCH (theme — harmless).
- Admin (`requireAdmin`, guests already fail as role `user`): `admin/settings/route.ts:9,14`; `admin/users/[userId]/quota/route.ts:10,16`.
- Unauthenticated: `setup/route.ts:7`, `registration/route.ts:7`.
- Reads that would show guests empty/irrelevant data: `providers/route.ts:9` GET (lists own + shared, `provider.service.ts:170-200`), `search-providers/route.ts:5` GET.

better-auth catch-all `src/app/api/auth/[...all]/route.ts:5` (`toNextJsHandler(auth)`) exposes, for any signed-in user:
- `/update-user`, `/change-password`, `/change-email`, `/delete-user` (disabled unless `user.deleteUser.enabled`, `api/routes/update-user.mjs:294`), `/revoke-session(s)`, `/revoke-other-sessions`, `/list-sessions`, `/list-accounts`, `/unlink-account`
- twoFactor: `/two-factor/enable` (`plugins/two-factor/index.mjs:73`), `/two-factor/disable` (:191), `/two-factor/generate-backup-codes`, `/two-factor/get-totp-uri`, `/two-factor/verify-totp`
- admin plugin `/admin/*` (role-gated by plugin + `roleHierarchy` hook `hierarchy.ts:24-31`)
- `/sign-in/email`, `/sign-in/username`
Blocking point: a `hooks.before` matcher on these paths checking `session.user.isAnonymous` (same shape as `hierarchy.ts:113-120`), or `disabledPaths` (static, global — would also block the operator).
Client callers: `ChangePasswordForm.tsx:29` (`changePassword`), `TwoFactorCard.tsx:168,200,219,253,278`, `AdminUsersScreen.tsx:63-157`.

## 4. Model resolution

- `src/server/ai/model-resolution.ts:14-71` `resolveAvailableModels(actor)`: `enabled = true AND (ownerId = actor OR visibility = 'shared')` (l.36-40). Guests own nothing -> see only shared configs. Single gate used everywhere.
- `src/server/ai/require-model.ts:27-42` `requireModelForActor(pair, actor)` — availability gate for /api/chat, regenerate, compression, background turn (`generation-turn.ts:174,309,503,634`).
- `provider.service.ts:46-55` `coerceVisibility`: non-staff can only create `private` configs; only staff can share.
- Shared configs are still filtered per-config only; to restrict guests to "operator-designated" models, filter in `resolveAvailableModels` (l.32-41) on actor kind.
- Side-call model choice: `model-preferences.service.ts:84` `resolveModelPreference(actor, purpose)` reads `users.model_preferences`, falls back to null. Callers:
  - title: `title.service.ts:91` (pref ?? client pair), `generateText` maxOutputTokens 40 (l.115); background caller `generation-runner.ts:586,772-786` (`generateTitleAfterTurn`); manual `api/topics/[id]/title/route.ts:7`.
  - compression: auto `generation-turn.ts:632-634`; manual `api/topics/[id]/compress/route.ts:22,29`; `compression.service.ts:308` `SUMMARY_MAX_OUTPUT_TOKENS`.
  - translation: `translation.service.ts:57` (pref ?? client pair), `createChatModelHandle` l.63, `generateText` ~l.66.
  - Writes: `model-preferences.service.ts:57` `updateModelPreferences` (validated against `resolveAvailableModels`).
- Search providers are **per-user private only** (`schema/search-provider.ts:13-16`, `search-provider.service.ts:43-50` `listRows` filters `userId`). `resolveSearchProviderCredentials(actor)` (`search-provider.service.ts:261`) -> guests have zero search credentials; tool mode silently runs without tools (`generation-turn.ts:581-592`). Demo needs operator credentials resolved for guests here.

## 5. Counting points

- **Turn admission**: `generation.service.ts:311-331` `admitTurn(input, prepare, actor)` -> `acceptTurn` (l.341-560, single tx). Callers: `api/chat/route.ts:34` (kind `send`), `api/topics/[id]/messages/[messageId]/regenerate/route.ts:41` (kinds `regenerate`/`edit`; enum `src/lib/schemas/generation.ts:12`). Request-path, so an AppError thrown here returns a localized envelope. Duplicate receipts return early (l.319-322) — don't count those.
- **Image**: same admission; branch at `generation-turn.ts:509` `if (selected.outputModalities.includes("image"))` -> `src/server/ai/image/turn.ts:209` `generateImageForEndpoint(...)`; outputs stored via `uploadFile(..., { skipSizeLimit: true })` (`image/turn.ts:263`) -> counted against storage quota, not single-file cap.
- **Text turn**: `generation-turn.ts:493` `runGenerationTurn` / `runTextTurn`; `streamText` with `maxOutputTokens: resolvedMaxOutputTokens(selected)` (l.718). `src/server/ai/output-budget.ts:3-8` = `Math.min(model.outputTokens, model.contextTokens)` — demo cap goes here.
- **Search/fetch**: `src/server/ai/search/tool.ts:119` `searchWeb.execute` and `:169` `fetchPage.execute` — one invocation per model tool call; built by `buildSearchTools(credentials)` (l.211) at `generation-turn.ts:585`. These run in the background executor (no request scope); failures return tool outputs (`search_failed`/`fetch_failed`) instead of throwing. Builtin (provider-native) search: `src/server/ai/builtin-search.ts:85` `withBuiltinWebSearch` (no per-call hook).
- **Concurrency**: only per-topic single active turn (`generation.service.ts:466-478`, `generation.topicBusy` 409). No per-user or global concurrency cap exists. `listActiveGenerations` (l.205) queries active rows per user — reusable for a per-user count.
- `chat_generations` rows are purged ~24h after finish (`purgeTerminalGenerations` l.949-975) — not a durable daily ledger.
- **Files**:
  - Relay upload `api/files/route.ts:11` -> `file.service.ts:296 uploadFile` (single-file cap l.307-316 via `maxFileBytes()`, quota `assertUploadQuota` l.318).
  - Direct: `api/files/presign/route.ts:13` -> `presignFile` (l.389, `maxBytes: maxFileBytes()` l.415); `api/files/complete/route.ts:41` -> `completeFile` (l.434, size + `quotaExceededError` l.454-462). Both 404 unless `S3_DIRECT_ACCESS`.
  - Provider Files API uploads: `src/server/ai/provider-files.ts:266`.
  - Quota: `src/server/files/quota.ts` `usageBytes` (sum `files.size_bytes`), `effectiveQuotaBytes` (user override -> `app_settings.file_storage_quota_bytes`), `quotaExceededError` -> `AppError("QUOTA_EXCEEDED", 413, "file.quotaExceeded", {used, quota})`. Upload-count per day: no existing counter.
  - Single-file cap: `src/server/files/limits.ts:13` `maxFileBytes()` from `FILE_UPLOAD_MAX_MB`.

## 6. Cleanup

- `src/server/ai/generation-runner.ts:146` `startGenerationRunner` -> `bootRunner` (l.162-198): recovery loop, then `state.sweepTimer = setInterval(() => void sweepQueued(state), SWEEP_INTERVAL_MS)` (l.193-197, `unref`). `SWEEP_INTERVAL_MS = 60_000` (l.66), `PURGE_EVERY_SWEEPS = 60` (l.68) -> purge hourly inside `sweepQueued` (l.200-220, try/catch logs `generation sweep failed`). Started from `src/instrumentation.ts:30-33`.
- Blob deletion: `FileStorage.delete(key)` (`src/server/files/storage.ts:34`; disk `rm force` l.106, S3 `DeleteObjectCommand` l.149). Patterns: `deleteFile` (`file.service.ts:779-791`: object first, then row, then `deleteProviderFileReferences`), `sweepOrphanFiles(actor)` (l.845-870). Provider-side copies: `src/server/files/provider-delete.ts:208 deleteProviderFileReferences(file)` + retry queue `provider_file_delete_retries` (not FK'd; `processDeleteRetries` l.266).
- FK cascades from `users.id` (`onDelete: "cascade"`): sessions, accounts, two_factors (`auth.ts:55,70,117`), chat_generations (`chat.ts:160`), assistants (`assistant.ts:13`), search_provider_settings, provider_configs, files (`file.ts:43`). Deleting the user row removes DB rows; blobs (`files.storage_key`) and provider file refs must be deleted first.
- Last activity: no column. Candidates: `sessions.updated_at` (refreshed ≤1/day, section 1), `users.updated_at` (only on prefs writes), `chat_generations.created_at` (purged after ~24h).

## 7. UI surfaces

- Shell: `src/app/(app)/layout.tsx:95-116` (server; resolves actor, renders `AppShell` with `user={{name, role}}`) -> `src/components/layout/AppShell.tsx:25-43` (banner slot candidate above `{children}` inside `SidebarInset`, l.35-38) -> `AppSidebar.tsx:30-46` (footer: `ThemeControl`, `SidebarUserMenu`; remaining-quota display candidate in `SidebarFooter`).
- Settings nav: `src/components/layout/SettingsNav.tsx:22-30` `SETTINGS_TABS` with `staffOnly` filter (l.45); rendered via `AssistantTree.tsx:128 <SettingsNav showUsers=...>`. Tabs to hide for guests: account, providers, search (and models if locked).
- Pages: `src/app/(app)/settings/account/page.tsx` (`ChangePasswordForm`, `TwoFactorCard`), `settings/providers/page.tsx` (`ProviderConfigsScreen canShare=isStaffRole`), `settings/search/page.tsx` (`SearchProvidersScreen`), `settings/models/page.tsx` (`ModelPreferencesScreen`), `settings/users/layout.tsx:156-162` (staff-only redirect pattern to reuse).
- User menu: `src/components/layout/SidebarUserMenu.tsx:37` sign-out (`src/lib/sign-out.ts`) — guest signing out drops the cookie = loses the guest.
- `/api/files/limits` consumers: `src/lib/api/files.ts:35-38 getFileLimits` (schema `src/lib/schemas/file.ts:30-42`); `src/hooks/use-file-limits.ts:20` (`fileKeys.limits()` query) used by `src/components/settings/files/UsageCard.tsx:31`; composer `src/components/chat/use-composer-attachments.ts:87-90` (falls back to `DEFAULT_FILE_LIMITS`).
- Client identity: `src/components/providers/AccountProvider.tsx:50-80` (reload/redirect on session change).

## 8. Error convention / i18n

- `src/server/errors.ts:16` `new AppError(code, status, messageKey, params?, details?)`; codes in `src/lib/api/error-contract.ts:10-19` (includes `FORBIDDEN`, `RATE_LIMITED`, `QUOTA_EXCEEDED`); `AppErrorMessageKey` is derived from `Messages["Errors"]` (l.29) — new keys must exist in the catalog to type-check.
- Catalogs: `messages/en.json` and `messages/zh-CN.json`, `"Errors"` namespace at line 587 of each; existing groups include `auth`, `account`, `registration`, `setup`, `file`, `generation`, `searchProvider`, `model`, `image`. Example: `file.quotaExceeded: "Storage quota exceeded: {used} used of {quota}"`. UI copy namespaces: `Auth`, `Layout`, `Account`, `Settings`, `Files`, etc. i18n runtime in `src/i18n/`.
- better-auth endpoint errors use `APIError.from("FORBIDDEN", {code, message})` (`hierarchy.ts:54-59`); the client maps them via `apiErrorMessage` with fallback keys (`src/lib/auth-client.ts:16`).
- Background-turn errors are localized via `hooks.t` in the runner (`generation-turn.ts` `runTextTurn` `const t = hooks.t`), not AppError envelopes.

## 9. Related specs

- Backend: `.trellis/spec/backend/index.md`, `auth-guidelines.md`, `error-handling.md`, `database-guidelines.md`, `quality-guidelines.md`, `directory-structure.md`, `logging-guidelines.md`, `provider-configs.md`, `model-preferences.md`, `chat-generation-lifecycle.md`, `chat-search-tools.md`, `chat-attachments.md`, `image-generation.md`, `chat-history-compression.md`, `chat-message-translation.md`
- Frontend: `.trellis/spec/frontend/index.md`, `i18n.md`, `component-guidelines.md`, `directory-structure.md`, `state-management.md`, `hook-guidelines.md`, `quality-guidelines.md`, `type-safety.md`, `chat-attachments.md`
- Guides: `.trellis/spec/guides/cross-layer-thinking-guide.md`, `code-reuse-thinking-guide.md`

## Caveats / Not Found

- Anonymous createUser omits `username` while `users.username` is NOT NULL -> must be filled by a databaseHook or the sign-in will 500.
- `getIP` returns null in production for multi-hop `X-Forwarded-For` unless `advanced.ipAddress.trustedProxies` (or a single-value header via `ipAddressHeaders`) is configured.
- No existing usage ledger table, per-user concurrency limit, global ceiling, or last-active column.
- Search credentials are per-user only; guests get no web search without a code change.
- Operator sign-in path when the login form is hidden is not defined in the PRD.
