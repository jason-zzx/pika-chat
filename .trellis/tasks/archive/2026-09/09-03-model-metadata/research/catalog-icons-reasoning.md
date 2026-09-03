# Catalog lookup, icons, and reasoning transport

Verified against the repo and live docs on 2026-09-03.

## models.dev lookup (no catalog table)

`https://models.dev/api.json` remains the metadata source (MIT,
`archive/2026-09/08-31-providers/research/model-metadata-sources.md`). Payload
was 4.4 MB / ~7500 models in that probe. There is still no icon field on a
model object. Provider logos exist at `https://models.dev/logos/{id}.svg`
and must not be fetched at render time (self-hosted, air-gap).

Match order for a typed `modelId`:

1. Exact `models[id]` under any provider.
2. Last path segment after `/` (SiliconFlow-style `Qwen/Qwen2.5-72B`).
3. Case-insensitive exact.

On fetch failure or timeout (10s, same as discovery): do not fail add; write
D2 defaults and log `warn`. Cache the parsed JSON in process memory with a
TTL (24h is enough). Do not persist the catalog.

`reasoning_options` in the live payload is
`[{ "type": "effort", "values": ["minimal", "low", "medium", "high"] }]`.
Store the `effort` values array. Ignore other option types this slice.

Vendor key on a hit: the models.dev **provider id** (openai, anthropic,
alibaba, …), which is the developer/lab more often than the user’s relay
name.

## Icons without antd

`@lobehub/icons` `ModelIcon` is the LobeChat API (`<ModelIcon model="gpt-4o" />`)
but peers on `antd` and `@lobehub/ui`. This repo has neither.

Use local static SVGs keyed by `vendorKey`, MIT-vendored from Lobe Icons /
models.dev logo sources (retain attribution). A short heuristic map covers
unmatched ids (`gpt-*` → openai, `claude*` → anthropic, `qwen*` → alibaba,
…). Unknown → generic mark. Owner override is the stored `vendorKey`.

Do not import the React `@lobehub/icons` package.

## Reasoning over OpenAI-compatible

`@ai-sdk/openai-compatible@3.0.41` already:

- Sends `reasoning_effort` from
  `providerOptions.openaiCompatible.reasoningEffort`
  (`openai-compatible-chat-language-model.ts:310-312`).
- Streams `delta.reasoning_content` / `delta.reasoning` as reasoning parts
  (`:658-661`).

The provider is created with `name: config.name` (user-chosen), so do **not**
key `providerOptions` on that name. Use the documented `openaiCompatible` key.

Auto (D1/D4): omit `reasoningEffort` entirely. Do not send `"auto"`; several
upstreams will 400.

`streamText({ reasoning })` is the portable AI SDK 7 API, but the compatible
adapter’s mapping of the top-level enum is less obvious than the explicit
provider option. This slice sets `providerOptions.openaiCompatible.reasoningEffort`
when the user picked a stored option.

Today `sendReasoning: false` (`src/app/api/chat/route.ts:146`). Flip to
`true`. `chatStoredPartSchema` already keeps `type: "reasoning"` parts;
`MessageItem` drops them.

## Effort switch state

Composer model pick is already Zustand client state
(`.trellis/spec/frontend/state-management.md`). Effort is the same kind:
per-session, not server data. Reset to Auto when the selected model’s stored
options do not include the current value.

The chat POST body must carry `reasoningEffort` so the Route Handler can
validate it against the resolved model row (do not trust the client).
