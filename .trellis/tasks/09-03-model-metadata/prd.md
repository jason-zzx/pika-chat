# Model metadata and vendor icons

## Goal

A configured model is a card, not an id: context size, multimodal support,
reasoning support, reasoning-effort options, and a developer vendor icon.
The owner can correct those fields. Chat can switch reasoning intensity
(default Auto) and shows a collapsible thinking region that closes when the
answer starts.

## Background

Phase-1 `provider_models` stores only `id` / `providerConfigId` / `modelId`
(`src/server/db/schema/provider.ts:38-54`). `08-31-providers` P1 deferred
metadata because no code path read it. That deviation is reversed here.
Availability is still one query (`resolveAvailableModels`). There is no
provider `kind`; vendor icons follow the model id, not the credential host.

Chat is still text-only for attachments
(`archive/2026-09/08-31-chat-streaming/prd.md:421`). `MessageItem` renders
`text` parts only (`src/components/chat/MessageItem.tsx:15-44`). The stream
sets `sendReasoning: false` (`src/app/api/chat/route.ts:146`) even though
stored parts already allow `reasoning`.

models.dev `api.json` has the requested fields plus `reasoning_options`;
`/v1/models` still returns ids only; ollama/vLLM/generic relays miss the
catalog (`archive/2026-09/08-31-providers/research/model-metadata-sources.md`).
`@lobehub/icons` ModelIcon is the LobeChat API but peers on antd; this repo
will not take that package.

## Requirements

- **R1.** `provider_models` stores context tokens, input/output modalities,
  reasoning, reasoning-effort options, vendor key, and a source
  discriminator. Rows are PATCH-able. Existing id-only rows fill on first
  read after migrate (lookup or defaults) and persist.
- **R2.** Add (typed or discover-select) looks up `modelId` in models.dev.
  Hit: copy catalog fields, source `catalog`. Miss or catalog error: 256K
  context, text-only, reasoning false, source `default`. Owner can edit.
- **R3.** Vendor icon is the model developer’s mark: local static SVGs keyed
  by `vendorKey`, heuristic from `modelId` when unset, generic fallback.
  Owner can pick a vendor. No custom upload, no antd, no CDN at render.
- **R4.** Owner of the config edits metadata (including shared configs).
  Other users see the same values on pickers and cannot PATCH.
- **R5.** `GET /api/models` and provider list responses expose the metadata so
  pickers do not grow a second query.
- **R6.** Model picker shows the icon plus quiet cues: a context label only
  when the row is 1M tokens or more (rounded to whole millions, `1M`), a
  compact vision icon, and a compact reasoning icon — both icons carry
  accessible names instead of cue words. Settings chips show the icon.
- **R7.** When the selected model has `reasoning: true`, the composer shows
  Auto plus that row’s stored effort options. Auto omits the upstream
  parameter. Catalog reasoning with an empty option list → Auto only. Owner
  enabling reasoning with an empty list seeds low/medium/high. Switching to
  a model that lacks the current value resets to Auto. Effort is client
  state, validated again on POST against the resolved row.
- **R8.** Chat streams reasoning parts (`sendReasoning: true`), persists
  them as today, and renders a collapsible thinking region: full width of
  the answer column, the whole header row toggles it, expanded while
  thinking, auto-collapsed when thinking finishes so the answer is on
  screen. While streaming and untouched, the content stays pinned to the
  newest output; scrolling up pauses following, and returning to the bottom
  or re-opening resumes it. User can re-open. `prefers-reduced-motion`
  respected.
- **R9.** A user PATCH sets source `user` and is not overwritten by lazy
  catalog fill. “Reset from catalog” is an explicit owner action.
- **R10.** Opening composer popovers (model picker, effort select) must not
  create page-level scrollbars: portal popups position with `position:
  fixed` so their overflow can never grow the document scroll area.

## Acceptance Criteria

- [ ] **AC1** Migration adds the metadata columns; it applies from an empty
      database. (R1)
- [ ] **AC2** Adding `gpt-4o` (or a stubbed catalog hit) stores catalog
      context, modalities, reasoning, effort options, and a vendor key.
      Adding `local-llama` (catalog miss) stores 256K, text-only, reasoning
      false. (R2)
- [ ] **AC3** A timed-out or failed models.dev fetch does not fail add; the
      row gets D2 defaults and a `warn` log with no catalog body. (R2)
- [ ] **AC4** Owner PATCH can change context, modalities, reasoning, options,
      and vendor; a second user receives `NOT_FOUND`. Shared cards do not
      offer edit. (R4, R9)
- [ ] **AC5** After migrate, an existing id-only row is filled on first list
      (stubbed hit or defaults) and is not re-looked-up once source is set.
      A `user` row is not overwritten by that fill. (R1, R9)
- [ ] **AC6** Picker and own settings chips show the vendor icon (generic
      when unknown). Picker shows a `1M` context label only at ≥1M tokens,
      plus vision and reasoning icons with accessible names; no cue words.
      (R3, R5, R6)
- [ ] **AC7** Composer effort control is absent when `reasoning` is false;
      present with Auto + stored options when true. Send with Auto includes
      no `reasoningEffort` / no `providerOptions`. A non-Auto value not on
      the row is `VALIDATION_FAILED`. (R7)
- [ ] **AC8** “Reset from catalog” on an owner dialog re-runs lookup and
      replaces fields even if source was `user`. (R9)
- [ ] **AC9** A streamed assistant message with reasoning parts shows an
      expanded thinking region — same width as the answer, whole header row
      toggles — that auto-collapses when text arrives; while streaming,
      untouched content stays pinned to the newest output, scrolling up
      pauses following, and re-opening re-pins. Reload still shows the
      collapsed block (re-openable). (R8)
- [ ] **AC10** `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass. (all)
- [ ] **AC11** Opening the model picker and the reasoning-effort select on
      the chat composer does not change `documentElement.scrollHeight` —
      no page scrollbar appears. (R10)

## Out of scope

- Attachment / image upload and multimodal *chat* (flags are stored and
  shown only).
- Truncating history to `context_tokens`.
- Persisted models.dev catalog table, admin “refresh all”, bundled snapshot.
- Pricing, tool_call, temperature, knowledge cutoff.
- Native Anthropic / Google adapters; provider `kind`.
- Custom icon file upload.
- Per-user overlays on shared model metadata.
- A fixed global effort list (none / xhigh / max unless the row stores them).

## Key decisions

- **D1** Persist, display, and use reasoning in chat. Not attachments or
  context truncation. Default intensity is Auto (omit the parameter).
- **D2** Lookup models.dev on add; unmatched → 256K / text / no reasoning.
- **D3** Local vendor SVGs + stored `vendorKey` override; no antd.
- **D4** Auto + that model’s stored `reasoning_options` only.
- **D5** Owner-only edits; shared consumers are read-only.
- **D6** Portal popups render `position: fixed` (Base UI `positionMethod`);
  absolute-positioned portals must never become document scroll.

## Risks

- Air-gapped installs never hit models.dev; they live on D2 defaults until
  the owner edits. A bundled snapshot is deferred.
- Icon heuristics will mis-tag some ids; vendor override is the escape hatch.
- `createOpenAICompatible({ name: config.name })` must not be used as the
  `providerOptions` key; always `openaiCompatible` (see research).
