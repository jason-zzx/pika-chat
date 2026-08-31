# Where model metadata comes from

Question being answered: for the provider/model configuration feature, where do
context window, max output tokens, modality support, and capability flags come
from?

All findings below were verified live on 2026-08-31, not recalled.

## Primary source: models.dev

`https://models.dev/api.json` — MIT licensed, actively maintained
(`anomalyco/models.dev`, ~6.7k stars, last push 2026-08-31).

Measured payload: **212 providers, 7494 models, 4.4 MB**.

Shape is a provider-keyed map:

```json
{
  "openai": {
    "id": "openai",
    "name": "OpenAI",
    "env": ["OPENAI_API_KEY"],
    "npm": "@ai-sdk/openai",
    "doc": "...",
    "models": { "gpt-5": { ... } }
  }
}
```

Real model entry (`openai.models["gpt-5"]`, verbatim from the live payload):

```json
{
  "id": "gpt-5",
  "name": "GPT-5",
  "description": "Original GPT-5 workhorse for reasoning, coding, writing, and tool workflows",
  "family": "gpt",
  "attachment": true,
  "reasoning": true,
  "reasoning_options": [{ "type": "effort", "values": ["minimal", "low", "medium", "high"] }],
  "tool_call": true,
  "structured_output": true,
  "temperature": false,
  "knowledge": "2024-09-30",
  "release_date": "2025-08-07",
  "last_updated": "2025-08-07",
  "modalities": { "input": ["text", "image"], "output": ["text"] },
  "open_weights": false,
  "limit": { "context": 400000, "input": 272000, "output": 128000 },
  "cost": { "input": 1.25, "output": 10, "cache_read": 0.125 }
}
```

This covers every field the feature needs — context window (`limit.context`),
max output (`limit.output`), multimodality (`modalities.input/output`),
attachments, tool calling, structured output, reasoning, knowledge cutoff, and
pricing.

Two provider-level fields are unusually valuable here:

- **`npm`** maps the provider straight to its AI SDK package
  (`openai` → `@ai-sdk/openai`, `deepseek` → `@ai-sdk/openai-compatible`). The
  provider registry can be driven from this instead of a hand-written mapping.
- **`env`** gives the conventional environment variable name, useful for
  bootstrapping config from env on first run.

Chinese-market coverage is good: `deepseek`, `zhipuai` (15 models),
`moonshotai` (10), `siliconflow` (49), `alibaba` are all present.

## Coverage gap that drives the design

Verified missing from models.dev: **`ollama`, `vllm`, `llamacpp`, and a generic
`openai-compatible` entry**. (`lmstudio` exists but with only 3 models.)

This is exactly the self-hosted long tail — local models and third-party
OpenAI-compatible relays are the case where a catalog lookup returns nothing.
So a catalog can never be the only source; manual entry is mandatory, not a
nice-to-have.

## Secondary source: provider `/v1/models` endpoint

OpenAI-compatible endpoints (including relays, vLLM, Ollama) expose
`/v1/models`, which lists model **ids only** — no limits, no modalities. Useful
for *discovery* ("which models does this endpoint actually serve?"), useless for
*metadata*.

`https://openrouter.ai/api/v1/models` is richer (655 KB, includes
`context_length`, pricing, and architecture/modality) but only covers models
routed through OpenRouter.

## Recommended design: four layers, in precedence order

1. **User override (highest precedence).** Whatever the operator or user typed
   in for that specific model always wins. Non-negotiable given the coverage gap
   above.
2. **Live catalog refresh.** Admin-triggered "update model catalog" pulls
   models.dev into PostgreSQL, with a TTL and a stored `fetched_at`. Must
   degrade gracefully — a self-hosted box may have no outbound internet.
3. **Endpoint discovery.** Query the provider's `/v1/models` to learn which ids
   are actually served, then left-join catalog metadata onto those ids. Ids that
   fail to join surface in the UI as "metadata unknown — please fill in".
4. **Build-time bundled snapshot (fallback floor).** Vendor a trimmed
   models.dev snapshot into the repo at build time so a fully air-gapped
   install still boots with sane defaults. MIT license permits this; retain the
   attribution.

Layer 4 matters more than it looks: a meaningful share of self-hosted installs
run on intranets, and "no internet means no model list" would be a broken
first-run experience.

## Implications for the data model

- Model metadata must be **nullable and overridable per model row**, not a
  foreign key into an immutable catalog table.
- Store catalog-sourced values and user-entered values in distinguishable
  fields (or keep a `source` discriminator), otherwise a catalog refresh will
  silently clobber the operator's hand-tuned values.
- Keep `fetched_at` / `catalog_version` so the UI can tell the operator how
  stale their catalog is.

## Sources

- https://models.dev/api.json (probed: HTTP 200, 4435684 bytes)
- https://github.com/anomalyco/models.dev (MIT)
- https://openrouter.ai/api/v1/models (probed: HTTP 200, 655383 bytes)
