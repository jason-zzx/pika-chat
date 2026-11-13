# Implement: Demo site mode

Ordered; each step should leave lint/typecheck green.

1. Env + schema
   - `src/server/env.ts`: `DEMO_MODE`, `DEMO_*` limits, `CLIENT_IP_HEADER`; boot check in `instrumentation.ts`; `.env.example` docs.
   - `users.is_anonymous`, `demo_usage_counters` table; `pnpm db:generate`.
2. Auth
   - anonymous plugin (demo only), username `databaseHooks`, `hooks.before`
     (IP cap, guest path block), `ipAddressHeaders`; `anonymousClient()`.
   - `Actor.isGuest`, `requireMember`; apply to providers/*, search-providers/*,
     account/2fa/*; model-preferences chat-only for guests; `generationActor` isGuest.
3. Operator resolution: search credentials + non-chat model preferences for guests.
4. `demo-usage.service.ts` + call sites: `acceptTurn` (model, global, busy),
   search/fetch tools, `uploadFile`/`completeFile`, `effectiveQuotaBytes`,
   `resolvedMaxOutputTokens`; `GET /api/demo/usage`.
5. Cleanup: `purgeInactiveGuests` wired into the hourly sweep when `DEMO_MODE`.
6. UI: instance `demo` flag, `DemoEntry` + `?admin=1`, sign-up redirect,
   banner, usage card, settings nav / models page / user menu for guests,
   i18n en + zh-CN.
7. Docs: README/deploy note on demo env vars and proxy IP header (design.md "Deployment note").

## Tests (real DB integration, no mocks, per repo convention)

- demo-usage service: limit boundary, day rollover, concurrent consume.
- acceptTurn: guest over limit rejected and nothing persisted; duplicate
  receipt not counted; busy guest rejected; non-guest unaffected.
- auth: anonymous sign-in creates guest with username; IP cap; null IP
  rejected; guest blocked on change-password / 2fa; plugin absent without flag.
- purgeInactiveGuests: stale guest + blobs removed, fresh guest and regular
  user kept.

## Validation

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Manual: `DEMO_MODE=1 pnpm dev`, two browsers → isolated guests; exhaust a
limit; `/sign-in?admin=1` operator login; unset flag → normal sign-in.

## Rollback points

- After step 2 the app still works in non-demo mode; steps are additive.
- Risky files: `src/server/auth/index.ts`, `generation.service.ts` (`acceptTurn` tx),
  `search/tool.ts`.
