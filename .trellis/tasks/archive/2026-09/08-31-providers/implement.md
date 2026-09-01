# Implementation Plan — Provider and Model Configuration

Branch off the current `feat/scaffold` head. Ten steps, each one leaving the
tree lint-clean and type-clean.

## Ordered checklist

1. **Schema and migration.** Add `src/server/db/schema/provider.ts` with the
   two `pgEnum`s and both tables exactly as in `design.md`. Export from
   `schema/index.ts`. Run `pnpm db:generate`, then apply against an empty
   database to prove AC1 before writing anything on top of it.
   → AC1

2. **`src/server/crypto.ts`.** `encryptSecret` / `decryptSecret`, the `v1.`
   envelope, and the lazily cached scrypt key. Unit test alongside it:
   round-trip, two encryptions differ, tampered tag throws.
   → AC4

3. **Zod schemas in `src/lib/schemas/provider.ts`.** `createProviderConfigSchema`,
   `updateProviderConfigSchema`, `addProviderModelSchema`, plus the inferred
   `*Input` types. Naming per
   `.trellis/spec/backend/directory-structure.md:110`. `baseUrl` must be a
   valid URL; `apiKey` optional and nullable.

4. **`provider.service.ts` — CRUD without discovery.** List (own + shared with
   the two distinct response shapes), create, update, delete. Visibility
   coercion in one shared helper. Owner filter in every `WHERE`. Unique-name
   violation mapped through `isUniqueViolation` to `CONFLICT`.
   → AC2, AC3, AC6, AC7, AC8

5. **Route handlers for CRUD.** `/api/providers` and `/api/providers/[id]`,
   each wrapped in `withErrorHandling`, four lines apiece.

6. **`src/server/ai/discovery.ts`.** The authenticated GET, the 10s abort, the
   tolerant Zod parse, and the `PROVIDER_ERROR` mapping that drops the upstream
   body. Unit test with a stubbed `fetch`.
   → AC9

7. **Model add / remove / discover in the service, plus their routes.** All
   three resolve the parent config through the owner filter first.
   → AC8, AC10

8. **`src/server/ai/model-resolution.ts` and `GET /api/models`.** One join,
   provenance derived. Integration test that a third user's private config is
   absent and that deleting a config drops its models.
   → AC11, AC12

9. **Settings UI.** `settings/providers/page.tsx` (Server Component, passes
   `canShare`), `ProviderConfigsScreen`, the create/edit form, the discover
   dialog with the manual-id escape hatch, and the new tab in `SettingsNav`
   without `staffOnly`. Component test for the share-toggle branch only.
   → AC13

10. **Full validation pass**, then a ponytail read of the diff — every session
    so far has cut something on that pass, and the likely candidates here are
    the `SharedConfig`/`OwnConfig` split collapsing into one mapper and any
    one-call wrapper around a Drizzle query.
    → AC14

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate                                  # must produce no new diff after step 1
docker compose up -d postgres && pnpm db:migrate  # must apply from empty
```

Manual browser pass before calling it done, since AC13 is not fully covered by
the component test:

- Sign in as a regular user, create a config against a real OpenAI-compatible
  endpoint, discover, add two models, confirm no share toggle is rendered.
- Sign in as an admin, create a shared config, then confirm the regular user
  sees it read-only with no base URL and no key mask.
- Narrow viewport pass on `/settings/providers`.

## Risky files and rollback points

| File | Risk |
|---|---|
| `src/server/db/migrations/0003_*.sql` | Never hand-edit after it is applied anywhere; write `0004` instead |
| `src/server/db/schema/index.ts` | Barrel edit; a missed export makes drizzle-kit silently skip a table |
| `src/server/crypto.ts` | Changing the envelope or the KDF salt after any row exists orphans every stored key |
| `src/server/services/provider.service.ts` | Every ownership check lives here; a fetch-then-check slip is a cross-tenant read |
| `src/components/layout/SettingsNav.tsx` | Shared with three existing tabs; do not add `staffOnly` to the new one |

Rollback is per-step: steps 1-8 are additive and touch no existing behavior.
Step 9 is the only edit to a file another feature renders.

## Before `task.py start`

- Confirm a reachable OpenAI-compatible endpoint and key are available for the
  manual pass in step 10; without one, discovery is only covered by the stub.
- Confirm `pika_chat_test` is up, since five of the fifteen acceptance criteria
  are integration tests.
