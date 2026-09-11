# Provider Configs

Contracts for `src/server/services/provider.service.ts` and
`src/lib/schemas/provider.ts`.

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
