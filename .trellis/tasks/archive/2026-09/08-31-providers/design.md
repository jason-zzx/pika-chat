# Design — Provider and Model Configuration

## Module map

```
src/server/db/schema/provider.ts        provider_configs, provider_models, visibility pgEnum
src/server/db/migrations/0003_*.sql     generated
src/server/db/migrations/0004_*.sql     drop unused kind + display_name
src/server/crypto.ts                    AES-256-GCM envelope; flat module like logger.ts
src/server/ai/discovery.ts              GET {baseUrl}/models adapter
src/server/ai/model-resolution.ts       the one availability query (D4 rule 2)
src/server/services/provider.service.ts CRUD, visibility coercion, ownership filters
src/lib/schemas/provider.ts             Zod request schemas + inferred types (isomorphic)
src/app/api/providers/route.ts          GET list, POST create
src/app/api/providers/[id]/route.ts     PATCH, DELETE
src/app/api/providers/[id]/discover/route.ts   POST
src/app/api/providers/[id]/models/route.ts     POST add, DELETE ?modelId=
src/app/api/models/route.ts             GET resolved availability
src/app/(app)/settings/providers/page.tsx
src/components/provider/*.tsx
```

`src/components/providers/` is already taken by React context providers
(`AppProviders.tsx`). Domain UI lives in `src/components/provider/` (singular),
matching the frontend directory spec. DELETE uses a query param rather than a
path segment so model ids that contain `/` (OpenRouter, SiliconFlow) survive.

`crypto.ts` sits flat in `src/server/` next to `env.ts`, `errors.ts`, and
`logger.ts` rather than in `ai/`, because it is a generic primitive that
happens to have one caller today.

## Data model

```ts
export const providerVisibility = pgEnum("provider_visibility", [
  "private",
  "shared",
]);

export const providerConfigs = pgTable(
  "provider_configs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    encryptedApiKey: text("encrypted_api_key"),   // null: local endpoint needs no key
    apiKeyLastFour: text("api_key_last_four"),    // denormalized so list never decrypts
    visibility: providerVisibility("visibility").notNull().default("private"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_configs_owner_name_uidx").on(t.ownerId, t.name),
    index("provider_configs_visibility_idx").on(t.visibility),
  ],
);

export const providerModels = pgTable(
  "provider_models",
  {
    id: text("id").primaryKey(),
    providerConfigId: text("provider_config_id").notNull()
      .references(() => providerConfigs.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),          // sent verbatim to the provider
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_models_config_model_uidx").on(t.providerConfigId, t.modelId),
  ],
);
```

Notes:

- No `kind` column and no `display_name`. A single OpenAI-compatible credential
  shape is assumed until a second adapter exists; the UI shows `modelId` as-is.
- No `updated_at` on `provider_models`: rows are added and removed, not edited.
- No metadata columns. See PRD P1 — this is deliberate and reviewers should not
  read `database-guidelines.md`'s catalog section as a requirement to add them
  before a catalog exists.
- `owner_id` cascades. Deleting a user removes their configs, including any
  shared ones (PRD P6, accepted).
- The unique index on `(owner_id, name)` gives a real `CONFLICT`; translate via
  the existing `isUniqueViolation` helper in `src/server/db/unique-violation.ts`.

## Credential envelope

`src/server/crypto.ts` exports `encryptSecret(plaintext): string` and
`decryptSecret(envelope): string`.

Format: `v1.<iv>.<ciphertext>.<authTag>`, each segment base64url. The `v1`
prefix is what makes an algorithm change later a migration rather than an
archaeology exercise; `decryptSecret` rejects an unknown prefix.

Key derivation: `scryptSync(CREDENTIAL_ENCRYPTION_SECRET, "pika-chat/credential-cipher/v1", 32)`,
computed once lazily and cached at module scope. scrypt costs ~100ms, so
deriving per call would be visible on a list request; the fixed salt is
acceptable because the secret is already high-entropy by the `min(32)` rule in
`src/server/env.ts:8` and the derivation is single-tenant.

`decryptSecret` throws `AppError("INTERNAL", 500, ...)` on a GCM tag mismatch.
That is the "someone changed the secret" case, and it must read as a server
fault, not as a validation error blamed on the user.

## Service contracts

Every function takes `(input, actor)` and never sees a Next.js type
(`.trellis/spec/backend/directory-structure.md:53`).

```ts
listProviderConfigs(actor): Promise<{ own: OwnConfig[]; shared: SharedConfig[] }>
createProviderConfig(input: CreateProviderConfigInput, actor): Promise<OwnConfig>
updateProviderConfig(id: string, input: UpdateProviderConfigInput, actor): Promise<OwnConfig>
deleteProviderConfig(id: string, actor): Promise<void>
addProviderModel(configId: string, input: AddProviderModelInput, actor): Promise<ProviderModel>
removeProviderModel(configId: string, modelId: string, actor): Promise<void>
discoverProviderModels(configId: string, actor): Promise<string[]>
```

Two response shapes, and the difference is the point of R4:

```ts
type OwnConfig = {
  id; name; baseUrl; visibility;
  apiKeyLastFour: string | null;
  models: ProviderModel[];
};
type SharedConfig = {
  id; name; ownerName;                 // provenance for the later picker
  models: ProviderModel[];
};                                     // no baseUrl, no mask
```

Visibility coercion lives in one private helper used by both create and
update:

```ts
const visibility = isStaffRole(actor.role) ? input.visibility : "private";
```

Not a thrown `VALIDATION_FAILED` — the spec calls for coercion, which is
friendlier and closes the hole just as firmly.

Ownership is always a `WHERE` clause:

```ts
.where(and(eq(providerConfigs.id, id), eq(providerConfigs.ownerId, actor.userId)))
```

Zero rows updated/deleted means `NOT_FOUND`, never `FORBIDDEN`
(`.trellis/spec/backend/error-handling.md:72`). Model mutations reach the
owner check through the parent config, so `addProviderModel` resolves and
filters the config first and never trusts `providerConfigId` from the body.

## Discovery adapter

`src/server/ai/discovery.ts`:

```ts
export async function fetchServedModelIds(baseUrl: string, apiKey: string | null): Promise<string[]>
```

- URL: `${baseUrl.replace(/\/+$/, "")}/models`. Base URLs are stored including
  the `/v1` segment, matching what `createOpenAICompatible({ baseURL })` wants
  in the chat task.
- `Authorization: Bearer <key>` only when a key exists; Ollama and vLLM serve
  unauthenticated.
- `signal: AbortSignal.timeout(10_000)`. A self-hosted box pointed at an
  unreachable relay must fail in seconds, not hang the request.
- Parse with a tolerant Zod schema — `{ data: [{ id: string }] }` with unknown
  keys allowed — and return `data[].id`.
- Every failure becomes `AppError("PROVIDER_ERROR", 502, <summary>)`. The
  summary is built from status and category only. The upstream body is
  deliberately dropped: provider errors routinely echo the request, which can
  contain the key (`.trellis/spec/backend/error-handling.md:82`).
- The adapter takes plaintext and does not read the database, so it is
  testable with a stubbed `fetch` and has no route to leaking a stored key.

No `@ai-sdk/openai-compatible` dependency is needed for discovery — it is one
authenticated GET. The package lands in `08-31-chat-streaming`, where a
language model is actually instantiated. Adding it here would be a dependency
with no importer.

## Resolution query

`src/server/ai/model-resolution.ts` — the function D4 rule 2 requires to be
singular:

```ts
export type AvailableModel = {
  configId: string;
  configName: string;
  modelId: string;
  provenance: "own" | "shared";
  ownerName: string | null;   // set when provenance is "shared"
};

export async function resolveAvailableModels(actor: Actor): Promise<AvailableModel[]>
```

One query, joining `provider_models` to `provider_configs` and filtering
`ownerId = actor.userId OR visibility = 'shared'`, left-joined to `users` for
the shared owner's name. `provenance` is derived from `ownerId === actor.userId`
rather than stored. A user's own shared config appears once, as `own`.

Exposed as `GET /api/models`. The route has no consumer inside this task; it
ships anyway because it is the contract that stops the chat and assistant tasks
from writing their own version of this query, which is exactly the drift D4
rule 2 names.

## Transport

| Method | Path | Guard |
|---|---|---|
| GET | `/api/providers` | `requireActor` |
| POST | `/api/providers` | `requireActor` (service coerces visibility) |
| PATCH | `/api/providers/[id]` | `requireActor` + owner filter |
| DELETE | `/api/providers/[id]` | `requireActor` + owner filter |
| POST | `/api/providers/[id]/discover` | `requireActor` + owner filter |
| POST | `/api/providers/[id]/models` | `requireActor` + owner filter |
| DELETE | `/api/providers/[id]/models?modelId=` | `requireActor` + owner filter |
| GET | `/api/models` | `requireActor` |

No `requireAdmin` anywhere: sharing is a coercion, not a gate, and every other
operation is owner-scoped. Handlers stay four lines — parse, authenticate,
delegate, respond — wrapped in `withErrorHandling`.

## UI

`/settings/providers` as a fourth tab in `src/components/layout/SettingsNav.tsx`,
**without** `staffOnly` (P4).

- `page.tsx` is a Server Component that resolves the actor and passes
  `canShare = isStaffRole(actor.role)` down. The role is never re-derived on
  the client.
- `ProviderConfigsScreen.tsx` (`"use client"`) owns the TanStack Query calls,
  copying the `useQuery` + `useMutation` + `invalidateQueries` shape in
  `src/components/admin/AdminUsersScreen.tsx:51`. No Zustand: this is server
  state (`.trellis/spec/frontend/state-management.md:17`).
- Sections: "Your providers" (full cards) and "Shared with the instance"
  (read-only, name + owner + model chips).
- The share toggle renders only when `canShare`. It is a UI affordance, not the
  enforcement — the service coerces regardless.
- `DiscoverModelsDialog` calls the discover mutation, lists returned ids with
  checkboxes, and always offers a free-text id field so a relay that does not
  implement `/models` is still usable (R6).
- Query keys: `["provider-configs"]` and `["available-models"]`; every provider
  mutation invalidates both, since a config edit changes availability.

## Testing

| Level | File | Covers |
|---|---|---|
| Unit | `src/server/crypto.test.ts` | AC4 round-trip, IV uniqueness, tamper rejection |
| Unit | `src/server/ai/discovery.test.ts` | AC9 with stubbed `fetch`: happy path, 401, timeout, non-JSON |
| Integration | `src/server/services/provider.service.integration.test.ts` | AC2, AC3, AC6, AC7, AC8, AC10, AC12 against `pika_chat_test` |
| Integration | `src/server/ai/model-resolution.integration.test.ts` | AC11 including the other-user-private-config exclusion |
| Component | `src/components/provider-configs/ProviderConfigsScreen.test.tsx` | AC13 share-toggle visibility only — the one rule-encoding branch in the UI |

Follows the existing `*.integration.test.ts` convention and the auth helpers in
`src/server/auth/auth-test-helpers.ts` for seeding users of each role.

## Trade-offs and risks

- **Save-before-verify.** With no separate test endpoint (P3), an invalid key
  is stored and only fails when the user clicks discover. Accepted: the error
  is immediate and actionable, and a verification flag would be state that goes
  stale the moment the upstream key is revoked.
- **Shared configs die with their owner.** P6 plus the `owner_id` cascade. The
  recovery is another admin creating their own config. Revisit if a second
  admin becomes common.
- **Fixed KDF salt.** Documented above; the alternative is a per-row salt
  column, which buys nothing against an attacker who already has the database
  and the single instance-wide secret.
- **`GET /api/models` ships without a caller.** Justified by D4 rule 2; if the
  chat task ends up not using it, delete it there rather than leaving two
  queries.
