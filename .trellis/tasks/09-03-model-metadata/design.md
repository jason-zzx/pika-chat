# Design — Model metadata and vendor icons

## Boundaries

This task extends the existing provider-model row, the single availability
query, provider settings, the composer picker, and the chat stream. It does
not add a catalog table, file uploads, or context-window truncation.

```
src/server/db/schema/provider.ts          metadata columns on provider_models
src/server/ai/model-catalog.ts           models.dev fetch + match + cache
src/server/ai/model-resolution.ts       project metadata onto AvailableModel
src/server/ai/chat-model.ts             unchanged instantiation
src/server/services/provider.service.ts  add fills; PATCH updates; lazy fill
src/lib/schemas/provider.ts              ProviderModel + AvailableModel + patch
src/lib/schemas/chat.ts                 optional reasoningEffort on POST
src/lib/model-vendor.ts                 vendorKey heuristic (isomorphic)
src/app/api/providers/[id]/models/route.ts   PATCH
src/app/api/chat/route.ts               sendReasoning; providerOptions
src/components/provider/*               edit dialog, icons on chips
src/components/chat/ModelPicker.tsx     icon + cues
src/components/chat/Composer.tsx      effort switch
src/components/chat/MessageItem.tsx    collapsible thinking
src/components/ui/collapsible.tsx       shadcn primitive (generated)
```

`src/server/ai/` already owns discovery and resolution
(`.trellis/spec/backend/directory-structure.md:29`). The catalog lookup sits
there, not in the service file. The service calls it on add / lazy fill /
explicit “reset from catalog”.

## Data model

`provider_models` becomes editable. Add `updated_at`.

| Column | Type | Notes |
|---|---|---|
| `context_tokens` | integer not null, default 256000 | D2 unmatched default |
| `input_modalities` | jsonb not null, default `["text"]` | store string[] |
| `output_modalities` | jsonb not null, default `["text"]` | |
| `reasoning` | boolean not null, default false | |
| `reasoning_options` | jsonb not null, default `[]` | effort strings only |
| `vendor_key` | text, nullable | null → generic / heuristic at render |
| `metadata_source` | text, nullable | `catalog` \| `default` \| `user`; **null = never filled** |
| `updated_at` | timestamptz | required now that rows are patched |

`metadata_source` stays nullable on purpose: existing rows after migration are
`NULL` and trigger the same lookup-or-defaults as add, then persist. A user
PATCH sets `user` and is not overwritten by lazy fill.

Do not use a second table. Do not FK into a catalog.

Shared configs: only the owner’s PATCH succeeds (`requireOwnedConfig`).
Resolution still returns metadata to every caller who can use the model.

## Catalog fill

`lookupModelMetadata(modelId): CatalogHit | null` in
`src/server/ai/model-catalog.ts`.

- GET `https://models.dev/api.json`, `AbortSignal.timeout(10_000)`.
- Module-scope cache + `fetched_at`. Failed fetch: `logger.warn`, return null
  (caller writes D2 defaults, source `default`).
- Map hit → `{ contextTokens, inputModalities, outputModalities, reasoning,
  reasoningOptions, vendorKey }` from `limit.context`, `modalities.*`,
  `reasoning`, effort values, provider id.
- Match ties. Several catalog providers host the same id with equal base
  scores (measured: `glm-5.2` under sensenova, zai, alibaba, zhipuai — all
  first-party, all 260; sensenova sits earlier in JSON key order and used to
  win, storing a wrong vendor key). `matchScore` adds a bonus when
  `vendorKeyFromCatalogProvider(providerId, modelId)` equals
  `vendorKeyFromModelId(modelId)`, so the stored vendor is deterministic
  regardless of JSON key order. `zhipuai-coding-plan` / `zai-coding-plan`
  alias to `zhipuai`. Rows already stored with a wrong vendor key recover
  through the owner’s “Reset from catalog”, no data migration.

`addProviderModel` always writes a filled row (hit or defaults). It never
inserts a bare id.

Lazy fill runs inside the existing list/resolution reads, only when
`metadata_source IS NULL`, then UPDATE. One catalog download serves the whole
batch.

## Transport contracts

`ProviderModel` and `AvailableModel` both grow the metadata fields (shared
Zod). `AvailableModel` remains the only shape the picker and composer read —
do not add a second query (database-guidelines D4 rule 2).

```ts
addProviderModelSchema            // still { modelId }
updateProviderModelSchema          // partial metadata + optional resetFromCatalog;
                                   // vendorKey pinned to MODEL_VENDOR_KEYS at the boundary
chatRequestSchema.reasoningEffort   // omit or the stored option string; never "auto"
```

PATCH ` /api/providers/[id]/models?modelId=` — query param keeps slash ids
working, same as DELETE.

Chat handler: resolve the available row; if `reasoning` is false, ignore
client effort. If true and the body has an effort, it must be in
`reasoning_options` or `VALIDATION_FAILED`. Then:

```ts
streamText({
  ...,
  maxOutputTokens: Math.min(output_tokens, context_tokens), // every turn capped at the row's stored output budget
  providerOptions:
    effort === undefined
      ? undefined
      : { openaiCompatible: { reasoningEffort: effort } },
  ...
  toUIMessageStream({ sendReasoning: true, ... })
})
```

## Icons

`src/lib/model-vendor.ts`: `vendorKeyFromModelId(modelId)` heuristic.
`src/components/provider/ModelVendorIcon.tsx`: map `vendorKey` → local SVG
component. Chat picker imports it from `components/provider/` (already the
cross-domain pattern for `useAvailableModels`).

Assets: a small set of MIT SVGs under `src/components/provider/vendor-icons/`,
not `@lobehub/icons`. Unknown key → generic mark. Dark mode: `currentColor` or
a light/dark pair; no hardcoded hex that breaks tokens.

## UI

**Settings (own card).** Model chips show icon + id. Click opens a dialog:
context tokens, input modalities (text / image / … checkboxes), reasoning
toggle, effort-option list (editable when reasoning is on; seeding low/medium
/high when the list is empty per D4), vendor select, “Reset from catalog”
(sets source back to catalog/default via lookup). Shared cards stay read-only
and still show icon + id.

**Picker.** Icon, model id, quiet cues — a context label only at ≥1M tokens
(`1M`, `2M`; hidden below), vision and reasoning as small icons with
accessible names — not a settings form.

**Composer.** If the selected available model has `reasoning: true`, show
an intensity control: Auto + stored options. Zustand field next to
`pickedModel`. Not sent when Auto. Hidden when reasoning is false.

**Thinking block.** New `ReasoningBlock` used by `MessageItem`. Concatenate
`reasoning` parts. shadcn Collapsible:

- Open while the in-flight assistant message still has an incomplete
  reasoning part (or reasoning with no text part yet).
- Auto-close when reasoning ends or text starts, even if the user did not
  click.
- Manual re-open after collapse.
- Full width of the existing `max-w-[52.5rem]` answer column; the whole
  header row (label + chevron) is the toggle target.
- While streaming and open, the scrollable content pins to the newest
  output: instant `scrollTop = scrollHeight` on each text change (no smooth
  scrolling, so `prefers-reduced-motion` needs nothing extra). Scrolling
  more than ~24px from the bottom pauses following; returning to the
  bottom, a new stream, or re-opening the block re-arms it.
- Trigger label: “Thinking” while streaming, “Thought” when done. Respect
  `prefers-reduced-motion`.
- Keyboard: the trigger is a button; content is not a live-region flood
  (the list already has a throttled “Assistant is responding”).

**Popup positioning.** Base UI `Positioner` defaults to `positionMethod:
'absolute'`: the portal wrapper is `position: absolute; top: 0; left: 0` +
`transform: translate(x, y)`, and its scrollable overflow participates in
the document scroll area — measured on the chat composer, opening the model
picker grew `documentElement.scrollHeight` 800 → 806 and a page scrollbar
appeared. The shared wrappers `ui/popover.tsx`, `ui/select.tsx`,
`ui/dropdown-menu.tsx`, and `ui/tooltip.tsx` pass `positionMethod="fixed"`;
fixed boxes never contribute to document scroll, and floating-ui keeps them
positioned on scroll.

## State

| Fact | Home |
|---|---|
| Model metadata | TanStack Query (`provider-configs`, `available-models`) |
| Picked model | Zustand (existing) |
| Effort | Zustand, reset to Auto on unsupported model change |
| Collapsible open | `useState` in `ReasoningBlock`, driven by streaming |

Do not copy AvailableModel into Zustand.

## Testing

| Level | Covers |
|---|---|
| Unit | catalog match (exact, suffix, miss, timeout → null) |
| Unit | vendor heuristic |
| Unit | `uiPartsFromJson` still keeps reasoning (already exists) |
| Integration | add fills from stubbed catalog; PATCH owner-only; shared list is read-only metadata; lazy fill of NULL source |
| Integration | chat POST rejects effort not on the row; Auto omits providerOptions |
| Component | picker shows icon; effort control hidden when `reasoning: false`; thinking auto-collapses when a text part appears; reasoning auto-follow (pins while streaming, pauses on scroll-up, re-arms on re-open); picker cue icons with accessible names |

Stub `fetch` for models.dev; never hit the network in CI.

## Trade-offs

- **Write-on-read for NULL source.** Same shape as first-assistant seed. First
  settings load after upgrade does one catalog GET then N updates. Accepted
  so existing `gpt-4o` rows are not stuck on 256K/text-only.
- **In-memory catalog, no snapshot.** Air-gapped add always gets D2 defaults.
  A bundled snapshot is a follow-on; logging-guidelines already named it.
- **`openaiCompatible` option key, not `config.name`.** The SDK adapter is
  constructed with the user’s provider display name; using that as the
  options key would break every install whose config is not literally
  `"openaiCompatible"`.
- **Heuristic icons will mis-tag some ids.** Vendor override is the product
  escape hatch (D3); do not grow a Cherry-Studio-sized regex museum in this
  slice.
