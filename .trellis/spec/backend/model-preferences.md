# Model Preferences (User-Level Default Models)

> Per-user default models for chat, title generation, context compression,
> and translation — landed with `09-20-default-model-preferences`. An
> explicitly set preference wins unconditionally; a stale preference
> (provider/model deleted) silently falls back to the pre-existing behavior.

## Scenario: resolving a user's default model for one of four purposes

### 1. Scope / Trigger

Any change to the four preference slots, the
`/api/account/model-preferences` endpoints, or the consumers (title,
translation, compression, composer model seeding, assistant creation
prefill).

### 2. Signatures

```ts
// src/lib/schemas/model-preferences.ts (isomorphic)
modelPairSchema: { providerConfigId, modelId }
modelPreferencesSchema: { chat?, title?, compression?, translation? }  // each nullish
parseModelPreferences(raw: unknown): ModelPreferences   // dirty jsonb → {}

// src/server/services/model-preferences.service.ts
getModelPreferences(userId): Promise<ModelPreferences>
updateModelPreferences(input, actor): Promise<ModelPreferences>
resolveModelPreference(actor, purpose): Promise<ModelPair | null>  // never throws
```

DB: `users.model_preferences jsonb` nullable — one column for all four
slots, `null` = no preferences. The value domain is guarded by zod on
read/write (same style as the theme columns), so manually edited or
future-shaped data degrades to empty preferences instead of breaking reads.

Endpoints: `GET` / `PATCH /api/account/model-preferences`. PATCH replaces
the whole set; a `null` slot clears it.

### 3. Contracts

- **Availability is enforced only at save time.** PATCH validates every set
  pair against `resolveAvailableModels(actor)` and rejects the whole write
  with `VALIDATION_FAILED` 400 `model.notAvailable`. A preference that later
  goes stale is a normal lifecycle event (providers can be deleted), so
  use-time resolution never errors.
- **`resolveModelPreference` is the single use-time gate**: returns the pair
  only when it is still in the caller's available-models list, else `null` —
  and the caller takes its own fallback path. Never re-inline this check.
- **Preferences are user-level only.** Every read/write filters by the
  current actor; there is deliberately no instance-level default.

### 4. Fallback matrix (what "silent fallback" means per consumer)

| Scenario | Preference usable | Preference unset/stale |
|---|---|---|
| Title generation (`title.service.ts`) | preference pair | request-body pair → truncated-text title |
| Translation (`translation.service.ts`) | preference pair | request-body pair → 400 `model.notAvailable` |
| Manual compression (`/api/topics/[id]/compress`) | preference pair | request-body pair → 400 `model.notAvailable` |
| Auto-compression (`/api/chat` route) | preference pair (threshold still uses the SESSION model's `contextTokens`) | session model handle |
| Composer model pick (`resolve-composer-model.ts`) | third chain level | two-level chain (topic last assistant pair → assistant default) |
| New-assistant prefill (`AssistantEditorDialog`, create mode) | `chat` slot prefills the default-model field | no prefill |

The three route schemas that carry a client pair
(`generateTopicTitleSchema`, `translateMessageRequestSchema`,
`compressTopicSchema`) declare the pair fields **optional**; the clients
keep sending them as the fallback.

### 5. Good / Base / Bad Cases

- Good: set `title` preference → new topics are named by the preferred
  model; clear it → the first message's model is used again.
- Base: fresh user → `model_preferences` is NULL → every consumer behaves
  exactly as before the feature.
- Bad: throwing when a preferred model was deleted — that would block
  unrelated operations (sending a chat, translating) with an error the user
  cannot act on. Fall back silently; only PATCH surfaces
  `model.notAvailable`.

### 6. Tests Required

- `model-preferences.service.integration.test.ts`: store/read-back,
  whole-set replacement with slot clearing, 400 on unavailable or foreign
  pairs, dirty-jsonb degradation, `resolveModelPreference` null on
  unset/stale (stored value left untouched).
- `api/account/model-preferences/route.test.ts`: GET ownership, PATCH
  replace/clear, zod 400, service 400 mapping, 401.
- Consumer coverage: title service (preference wins, client-pair fallback,
  no-pair truncated title), translation integration (preference wins,
  no-pair 400), chat route (auto-compression uses the preference handle,
  threshold unchanged), `resolve-composer-model.test.ts` (third chain
  level), `AssistantEditorDialog.test.tsx` (create-mode prefill, stale
  preference not prefilled), `ModelPreferencesScreen.test.tsx` (four rows,
  save-on-change, per-slot clear, reset-all, zh-CN).

## Settings UI (`/settings/models`)

Independent settings page (not part of General): four `SettingsRow`s with
`ModelPicker` (`allowClear` = per-slot reset), save-on-change via the
optimistic `useUpdateModelPreferences` mutation (cache snaps, rolls back on
error, failure toast `Errors.actions.saveDefaultModel`), and a "Reset all"
button clearing all four slots. `SettingsNav` gains a `settingsNav.models`
tab after General; copy lives in `Settings.Models.*` (en + zh-CN).
