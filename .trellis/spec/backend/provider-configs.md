# Provider Configs

Contracts for `src/server/services/provider.service.ts` and
`src/lib/schemas/provider.ts`.

## API format (`api_format`)

Landed with `09-12-provider-api-format-ext`. A provider config speaks exactly
one endpoint format, chosen at create/edit time.

| value | endpoint | default base URL | API key |
|---|---|---|---|
| `openai-compatible` | OpenAI Chat Completions (and compatible relays) | `https://api.openai.com/v1` | optional |
| `claude` | Anthropic Messages | `https://api.anthropic.com/v1` | required |
| `google` | Gemini `generateContent` | `https://generativelanguage.googleapis.com/v1beta` | required |

### Storage

`provider_configs.api_format` is a `pgEnum("provider_api_format", …)`,
`NOT NULL DEFAULT 'openai-compatible'` (migration `0014_pale_mongu.sql`). The
default means pre-existing rows need no backfill and behave exactly as before.

### Single source of truth

`src/lib/provider-format.ts` owns `PROVIDER_API_FORMATS`,
`DEFAULT_PROVIDER_API_FORMAT`, `PROVIDER_FORMAT_DEFAULTS`
(`defaultBaseUrl` + `apiKeyRequired`), `isProviderApiFormat()` and
`requiresApiKey()`. It is client-safe (no `server-only`) because the form needs
the same defaults the server validates against.

**Adding a format** = one entry there + one `FORMAT_*` arm each in
`provider-factory.ts`, `builtin-search.ts` and `discovery.ts`. The
`Record<ProviderApiFormat, …>` maps make every one of those a compile error
until handled.

### Contracts

- `ownProviderConfigSchema` carries `apiFormat`; `createProviderConfigSchema`
  defaults it; `updateProviderConfigSchema` leaves it optional (an update that
  omits it keeps the stored value). `sharedProviderConfigSchema` deliberately
  does **not** expose it — shared configs publish models, not endpoint details.
- **API key requirement.** A format with `apiKeyRequired` must end up with a
  key. Enforced in the service, for create and update alike, by
  `assertApiKeyAvailable(format, hasKey)`, which throws
  `VALIDATION_FAILED` / `provider.apiKeyRequired` **before** any write:
  - create: `hasKey = apiKey !== null`.
  - update: `hasKey` is computed **after** the patch — an explicit
    `apiKey: null` clears the key (so it counts as absent), an omitted field
    keeps the stored one, a new value replaces it:

    ```ts
    const hasKey =
      input.apiKey === null
        ? false
        : (typeof input.apiKey === "string" && input.apiKey.length > 0) ||
          existing.encryptedApiKey !== null;
    ```

    `requireOwnedConfig` has already loaded the row, so this costs no extra
    query.
  - The rule lives in the service rather than in Zod because update has to read
    the stored row to answer it; keeping both paths together also keeps the
    error key identical. Zod still owns shape.
- **Provider construction** is `createLanguageModel(endpoint, modelId, options)`
  in `src/server/ai/provider-factory.ts`, a
  `Record<ProviderApiFormat, (context) => LanguageModel>`. Only
  `openai-compatible` has `.chatModel`; the anthropic and google providers are
  callable — `provider(modelId)`.

  | format | construction |
  |---|---|
  | `openai-compatible` | `createOpenAICompatible({ name, baseURL, apiKey: apiKey \|\| undefined, includeUsage: true })` |
  | `claude` | `createAnthropic({ baseURL, apiKey })` |
  | `google` | `createGoogle({ baseURL, apiKey })` |

- **Model discovery** is `fetchServedModelIds({ apiFormat, baseUrl, apiKey })`
  in `src/server/ai/discovery.ts`; all three hit `{baseUrl}/models` but differ
  in auth and response shape:

  | format | auth | response |
  |---|---|---|
  | `openai-compatible` | `Authorization: Bearer` (omitted when keyless) | `{ data: [{ id }] }` |
  | `claude` | `x-api-key` + `anthropic-version: 2023-06-01` | `{ data: [{ id }] }` |
  | `google` | `x-goog-api-key` | `{ models: [{ name, supportedGenerationMethods? }] }`, `models/` prefix stripped, entries without `generateContent` dropped (a missing or `null` `supportedGenerationMethods` keeps the model) |

  **Nullability is load-bearing here.** Gemini-compatible gateways answer with
  explicit `null`s for everything the upstream left unset
  (`baseModelId`, `inputTokenLimit`, `supportedGenerationMethods`, …). A schema
  of `z.array(z.string()).optional()` accepts `undefined` but **rejects
  `null`**, which failed the entire listing with `provider.unexpectedResponse`
  even though the endpoint answered HTTP 200 — observed on a self-hosted
  gateway at `/v1beta/models`. Use `.nullish()` for optional numeric/array
  fields in provider response schemas.

  Timeout / status / parse-failure mapping is unchanged: `PROVIDER_ERROR` with
  the existing `provider.*` message keys, upstream bodies never echoed.

### Wrong vs Correct

```ts
// Wrong — a patch that explicitly clears the key still counts as "has a key",
// so a claude config could be saved keyless.
assertApiKeyAvailable(apiFormat, incomingKey || existing.encryptedApiKey !== null);
```

```ts
// Correct — model the state *after* the patch: an explicit null clears, an
// omitted field keeps the stored key.
const hasKey =
  input.apiKey === null
    ? false
    : (typeof input.apiKey === "string" && input.apiKey.length > 0) ||
      existing.encryptedApiKey !== null;
assertApiKeyAvailable(apiFormat, hasKey);
```

```ts
// Wrong — gateways send an explicit `null`, and `.optional()` only permits
// `undefined`, so HTTP 200 responses get rejected as unexpected.
supportedGenerationMethods: z.array(z.string()).optional(),
```

```ts
// Correct
supportedGenerationMethods: z.array(z.string()).nullish(),
```

### Tests

`provider.service.integration.test.ts` covers: explicit format persisted and
read back; keyless claude create rejected with nothing persisted; keyless
openai-compatible create accepted; format switch reusing the stored key;
format switch with no stored key rejected with the row left on its old format;
clearing a claude key rejected; clearing an openai-compatible key allowed.

## addProviderModel metadata overrides

`addProviderModelSchema` is `{ modelId }` merged with
`updateProviderModelSchema.omit({ resetFromCatalog: true })` — every
metadata field (`contextTokens`, `outputTokens`, `inputModalities`,
`outputModalities`, `reasoning`, `reasoningOptions`, `vendorKey`) is
optional on add.

### Contract

- The add dialog only sends fields the user touched (client-side dirty-field
  tracking in `ModelEditorDialog`). Untouched fields stay `undefined` and
  defer to the catalog fill (`fillMetadataForModelId`).
- Any present field overrides the catalog value, and the row is then marked
  `metadataSource: "user"`.
- `vendorKey: null` is an explicit clear, distinct from `undefined`
  (untouched) — the merge must not treat them the same.

### Server merge

```ts
const { modelId, ...overrides } = input;
const fill = await fillMetadataForModelId(modelId);
const hasOverrides = Object.values(overrides).some((v) => v !== undefined);
```

When `hasOverrides`, build metadata field-by-field (`input.x ?? fill.x`,
except `vendorKey` where `null` clears), set `metadataSource: "user"`, and
seed `reasoningOptions` with `SEEDED_REASONING_OPTIONS` if reasoning was
turned on with an empty list. Without overrides the row stays
`metadataSource: "catalog"` with the pure catalog fill.

### Tests

`provider.service.integration.test.ts` asserts both branches: an override
wins over the catalog and marks `metadataSource: "user"`; untouched fields
keep catalog values and the untouched row keeps its non-user source.
