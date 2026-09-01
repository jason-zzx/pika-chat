# Provider and Model Configuration

## Goal

An operator finishes `docker compose up`, signs in, adds one provider
credential, picks the models they care about, and ends up with a concrete list
of models that chat can call. A regular user can bring their own key without
ever being able to spend — or expose — the instance's shared credentials.

This task owns the provider/model half of that: the data model, encrypted
credentials, endpoint-driven model discovery, and the single resolution
function every later model picker must call. It does not send a chat
completion; `08-31-chat-streaming` does.

## Background

### Decided upstream — do not relitigate

From `.trellis/spec/backend/database-guidelines.md` and D4 of
`.trellis/tasks/archive/2026-08/00-bootstrap-guidelines/research/tech-stack-decision.md`:

- **One table keyed by owner + visibility**, not separate admin/user tables.

  | Creator | `visibility` | Usable by |
  |---|---|---|
  | admin | `shared` | every user on the instance |
  | admin | `private` | that admin only |
  | regular user | `private` (forced) | that user only |

- `visibility = 'shared'` is an **admin-only transition, coerced in the service
  layer**, not rejected as a validation error. The Route Handler receives
  arbitrary JSON, so hiding the control in the UI is not sufficient.
- **Model availability is a derived query, not a stored list**: admin `shared`
  configs ∪ the caller's own configs, resolved in exactly one function so chat,
  assistant defaults, and the model picker cannot drift.
- **The picker must show provenance** — a shared config and a user's own config
  can offer the same model id, and the user has to know whose quota is spent.
- **API keys are encrypted at rest** with authenticated encryption. Plaintext
  never leaves the service layer; responses carry a masked form only. The
  operator consequence of losing `CREDENTIAL_ENCRYPTION_SECRET` is already
  documented (`README.md:36`, `.env.example:7`).
- **Ownership isolation is a `WHERE` clause**, never fetch-then-check, and a
  row that fails the ownership filter is `NOT_FOUND`, never `FORBIDDEN`
  (`.trellis/spec/backend/error-handling.md:72`).

### Existing code this builds on

| Concern | Anchor |
|---|---|
| Encryption secret already validated at boot | `src/server/env.ts:8` (`CREDENTIAL_ENCRYPTION_SECRET`, min 32) |
| Actor contract (cookie or Bearer, role parsed) | `src/server/auth/actor.ts:29` |
| Staff gate inside a service, not only at the route | `src/server/services/instance-settings.service.ts:46` |
| Route Handler shape and the layering rule | `.trellis/spec/backend/directory-structure.md:74` |
| `src/server/ai/` is the designated home for the registry and resolution | `.trellis/spec/backend/directory-structure.md:29` |
| Single error wrapper; no per-handler try/catch | `src/app/api/_lib/with-error-handling.ts` |
| `AppError` codes incl. `PROVIDER_ERROR` | `src/server/errors.ts:3` |
| UUIDv7 ids | `src/lib/id.ts:4` |
| Settings tabs are routes, staff-only flag supported | `src/components/layout/SettingsNav.tsx:14` |
| Server state belongs to TanStack Query, never Zustand | `.trellis/spec/frontend/state-management.md:17` |
| Query/mutation + invalidate pattern to copy | `src/components/admin/AdminUsersScreen.tsx:51` |
| Migrations in `src/server/db/migrations/`, latest `0002` | `drizzle.config.ts` |

`ai@7.0.85` and `@ai-sdk/react@4.0.88` are installed; no `@ai-sdk/<provider>`
package is.

### Research

`research/model-metadata-sources.md`, verified live 2026-08-31: models.dev
`api.json` is MIT and carries every metadata field, but is **missing**
`ollama`, `vllm`, `llamacpp`, and generic OpenAI-compatible relays — precisely
the self-hosted long tail. A provider's `/v1/models` returns **ids only**, no
limits, no modalities, no capability flags.

## Decisions

**P1 — Catalog depth: user entry plus endpoint discovery. No models.dev.**
Phase-1 chat is plain text, so no code path reads `limit.context`,
`modalities`, `tool_call`, or `reasoning`. The product needs a selectable model
id with a display name and nothing else.

Consequence for the schema, and it is a deliberate deviation worth stating:
`provider_models` gets **no** metadata columns, **no** `source` discriminator,
and **no** `fetched_at`. Those rules in `database-guidelines.md` exist to stop
a catalog refresh from clobbering hand-tuned values; with no catalog, every row
is user-entered, so the columns would hold one constant value each. They bind
the future models.dev importer, not this task.

**P2 — One credential shape: OpenAI-compatible base URL plus optional API key.**
A single `/v1/models` discovery implementation covers OpenAI, DeepSeek, Zhipu,
Moonshot, SiliconFlow, Ollama, vLLM, LM Studio, and relays. Anthropic and Google
both expose OpenAI-compatible endpoints, which suffices for text chat; their
native features are not exposed in phase 1 anyway. There is no `kind` column
until a second adapter exists.

**P3 — Credential verification is discovery.** A successful authenticated
`GET {baseUrl}/models` is the connection test. No separate test endpoint,
button, or stored verification state.

**P4 — Regular-user BYOK ships here.** Resolved by D4 and the spec, not by
preference: the service-layer coercion of `visibility` to `private` exists
precisely because a regular user can POST `{"visibility":"shared"}`. Shipping
admin-only would leave that rule as untestable dead code. Both roles use the
same settings route; admins additionally get the share control.

**P5 — Discovered models are a picker source, not a mirror.**
`provider_models` holds only rows the user explicitly added. `/v1/models`
returns ids and nothing else, so no code can separate a chat model from an
embedding, rerank, tts, or whisper model — OpenAI and SiliconFlow return those
in the same list. A human has to choose either way, so the choice is persisted
rather than the raw list. This removes re-discovery merge logic entirely:
nothing to reconcile, nothing that can clobber a hand-edited row.

**P6 — Strict owner isolation, including for `shared` configs.** Only the
creating admin may edit or delete a config; other admins may only use it. This
matches the spec's refusal to bake an admin-sees-everything shortcut into a
query, and keeps one filter path in the service layer. Accepted cost: deleting
the admin who owns a shared config cascades that config away for everyone, and
no other admin can take it over first.

## Requirements

**R1 — Provider config CRUD.** A signed-in user can create, list, rename,
re-point, re-key, and delete their own provider configs. Fields: display name,
base URL, optional API key (local Ollama and vLLM need none).

**R2 — Visibility coercion.** `visibility` is `private | shared`. On create and
on update the service coerces a non-staff actor's value to `private`. Staff may
set either.

**R3 — Credentials encrypted at rest.** AES-256-GCM with a key derived from
`CREDENTIAL_ENCRYPTION_SECRET`. Stored as a self-describing versioned envelope.
Plaintext is decrypted only at the moment of an outbound provider call and is
never retained, logged, or returned.

**R4 — Masked credential display.** Responses expose at most the last four
characters, read from a denormalized column so a list response never decrypts
anything. Non-owners viewing a `shared` config see its name and models only —
not its base URL, not the mask.

**R5 — Model discovery.** `POST /api/providers/{id}/discover` performs an
authenticated `GET {baseUrl}/models` and returns the model ids the endpoint
serves. Owner-only. Upstream failures — bad key, unreachable host, endpoint not
implemented, non-JSON body — surface as `PROVIDER_ERROR` with a summarized
message; the upstream body is never echoed.

**R6 — Curated model list.** The owner adds models to a config by picking from
the discovery result or by typing an id by hand, and can remove them. Manual
entry must work with no successful discovery, because relays and air-gapped
endpoints may not implement `/v1/models`.

**R7 — Single resolution function.** One exported function returns the models
available to an actor: models of `shared` configs owned by anyone, union models
of the actor's own configs. Each entry carries provenance — config id, config
name, and whether it is the actor's own or shared by another user. It is
exposed as `GET /api/models` so that later tasks consume the contract instead
of rewriting the query.

**R8 — Settings surface.** `/settings/providers`, visible to every role,
listing the actor's own configs and, read-only, the configs shared with the
instance. Create/edit forms, the share toggle for staff only, discovery, and
model add/remove. Responsive at both breakpoints.

No documentation requirement: the scaffold task already wrote the
`CREDENTIAL_ENCRYPTION_SECRET` loss consequence into `README.md:36` and
`.env.example:7`.

## Acceptance Criteria

- [ ] **AC1** Migration `0003` applies cleanly to an empty database and creates
      `provider_configs` and `provider_models` with `snake_case` plural names,
      `text` UUIDv7 primary keys, and `timestamptz` timestamps. (R1)
- [ ] **AC2** A regular user POSTing `{"visibility":"shared"}` to
      `/api/providers` gets a `201` whose stored row is `private`. Same for
      `PATCH`. Verified against the service, not the UI. (R2)
- [ ] **AC3** An admin can create a `shared` config and a regular user's
      resolution result includes its models. (R2, R7)
- [ ] **AC4** Encrypt/decrypt round-trips; two encryptions of the same
      plaintext differ; a tampered ciphertext fails to decrypt rather than
      returning garbage. (R3)
- [ ] **AC5** No API response body, log line, or error `details` contains a
      plaintext key. Grepping the provider service for a log of the key field
      finds nothing. (R3, R4)
- [ ] **AC6** `GET /api/providers` returns a mask of at most four characters
      and performs no decryption. (R4)
- [ ] **AC7** A non-owner reading a `shared` config receives its name and
      models but no `baseUrl` and no mask. (R4)
- [ ] **AC8** `PATCH`/`DELETE`/discover/model-mutation against a config owned
      by someone else returns `404`, not `403`, and the ownership filter is in
      the `WHERE` clause. Holds for an admin acting on another admin's `shared`
      config. (R1, P6)
- [ ] **AC9** Discovery against a stubbed endpoint returns the served ids; a
      `401`, a timeout, and a non-JSON body each surface as `PROVIDER_ERROR`
      with no upstream body in the message. (R5)
- [ ] **AC10** A model id can be added by hand to a config that has never had a
      successful discovery, and it appears in the resolution result. (R6)
- [ ] **AC11** The resolution function returns own-config models ∪ shared
      models, each tagged with its config id, config name, and own/shared
      provenance; a private config belonging to another user never appears.
      (R7)
- [ ] **AC12** Deleting a config removes its models and drops them from the
      resolution result. (R1, R7)
- [ ] **AC13** `/settings/providers` renders for a regular user and for an
      admin; the share toggle is absent for the regular user; both breakpoints
      are usable. (R8)
- [ ] **AC14** `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass. (all)

## Out of Scope

- models.dev catalog import, admin refresh action, bundled snapshot (P1)
- Metadata columns: context window, output limit, modalities, capability flags
  (P1)
- Native Anthropic / Google / Ollama provider adapters (P2)
- A standalone credential test endpoint or stored verification state (P3)
- Encryption key rotation and re-encryption tooling
- Sending a chat completion or instantiating a language model for inference,
  and therefore the `@ai-sdk/openai-compatible` dependency itself
  (`08-31-chat-streaming`) — discovery is one authenticated GET and needs no
  SDK package
- The composer model picker UI and assistant default-model binding
  (`08-31-chat-streaming`, `08-31-assistants-topics`) — both must consume R7
- Per-user token accounting and quotas (deferred past phase 1 by D5)
