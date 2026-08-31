# Tech Stack Decision Record

Status: in progress (greenfield — no code exists yet)
Owner: zzx
Feeds: `.trellis/spec/backend/*`, `.trellis/spec/frontend/*`, `.trellis/config.yaml`

## Product context

Self-hosted AI chat website. Phase-1 scope: text chat, PC + mobile responsive
layout, provider/model configuration, assistants and topics, basic user
management.

The "self-hosted" positioning is the dominant constraint: deployment must stay
close to a single `docker compose up`, and the operator is typically an
individual or a small team, not a high-concurrency tenant.

## Decided

### D1 — Next.js fullstack monolith (confirmed by user)

Next.js App Router + TypeScript + Tailwind + shadcn/ui + Zustand + Drizzle ORM
+ Auth.js + Vercel AI SDK.

Rationale: one process, one image, minimal self-host friction. Vercel AI SDK
has the most mature multi-provider streaming support, which directly covers the
"configure providers and models" requirement.

Rejected alternatives:
- Split frontend/backend (React+Vite / Hono or NestJS): cleaner boundaries but
  two services to orchestrate and an API contract to maintain; slower to MVP.
- Python backend (FastAPI + React): richer Python AI ecosystem but dual-language
  with no end-to-end type sharing.

### D2 — Native mobile app must stay reachable (confirmed by user intent)

Phase 1 ships responsive web only. A native app is a plausible later phase, so
the architecture must not foreclose it.

Evidence: Vercel AI SDK ships official Expo / React Native support. `useChat`
works in RN when the transport is given `expo/fetch` instead of global fetch
(requires Expo SDK 52+).
Source: https://ai-sdk.dev/docs/getting-started/expo

Known caveat: mobile OSes abort in-flight fetch when the app is backgrounded,
which kills active LLM streams. The upstream answer is resumable streams
(`useChat({ resume: true })` plus a server-side active-stream store, e.g.
`vercel/resumable-stream`).
Sources:
- https://github.com/expo/expo/issues/42946
- https://ai-sdk.dev/docs/troubleshooting/abort-breaks-resumable-streams

#### Architectural constraints this imposes on phase 1

These are the cheap-now / expensive-later decisions. They must be encoded in
`.trellis/spec/backend/` so every future sub-agent honors them:

1. **Every business capability is exposed as an HTTP Route Handler**
   (`app/api/**/route.ts`). Server Actions are limited to trivial form
   mutations, or banned outright. RSC must not be the only path to a
   capability. A React Native client can call a Route Handler; it cannot call a
   Server Action or render an RSC.
2. **Transport and domain logic are separate layers.** Route Handlers do
   parse/authorize/respond only; business logic lives in a service layer that
   has no Next.js request objects in its signature. This keeps the same service
   callable from a future app-facing API version.
3. **Auth must not be cookie-only.** Auth.js defaults to a cookie session,
   which a native client cannot ride on. Use a JWT session strategy and accept
   `Authorization: Bearer` alongside the cookie from day one.
4. **Chat message persistence is server-authoritative**, not client-cached
   only. Resumable streams and multi-device continuity both depend on the
   server owning conversation state.

Cost of honoring these in phase 1: near zero — it is a layering discipline, not
extra product work. Cost of retrofitting later: a full API extraction pass.

### D3 — PostgreSQL only, deployed via Docker Compose (confirmed by user)

Drizzle ORM against PostgreSQL. No SQLite path, no dual-dialect abstraction.

Rationale: `docker compose up` is still a one-liner for the operator, and in
exchange `jsonb`, full-text search, and `pgvector` are all natively available —
so a later knowledge-base / RAG phase needs no migration. Drizzle + PostgreSQL
is also the most mature pairing.

Accepted cost: one extra container, roughly +100MB resident memory.

Rejected alternatives:
- SQLite only: best self-host ergonomics (single container, file-copy backups)
  but weak concurrent writes and a weak vector-search story (`sqlite-vec`).
- Dual support: forces every query into the SQLite ∩ PostgreSQL feature
  intersection and doubles the migration surface.

Follow-on: the resumable-stream active-stream store (see D2) can live in
PostgreSQL rather than requiring Redis.

### D4 — Multi-user, with a unified owned/visibility provider model (confirmed by user)

Provider configurations live in one table keyed by owner and visibility, not in
two separate admin/user tables.

| Creator | `visibility` | Who can use it |
|---|---|---|
| admin | `shared` | every user on the instance |
| admin | `private` | that admin only |
| regular user | `private` (forced) | that user only |

Regular users may bring their own key (BYOK) but may never publish it to the
instance.

#### Rules this imposes

1. **`visibility = shared` is an admin-only transition, enforced server-side.**
   A regular user creating or updating a provider config must have visibility
   coerced to `private` in the service layer. Hiding the control in the UI is
   not sufficient — the Route Handler receives arbitrary JSON.
2. **Model availability is a derived query, not a table.** The models a user
   may select = models of admin `shared` configs ∪ models of that user's own
   configs. This resolution belongs in one service function so that chat,
   assistant defaults, and the model picker cannot drift apart.
3. **API keys are encrypted at rest.** Requires a server-side secret from the
   environment. Self-host note that must reach the operator docs: losing that
   secret makes every stored credential unrecoverable.
4. **The model picker must show provenance.** An admin `shared` config and a
   user's own config can both offer the same model id; the UI has to
   distinguish them or the user cannot tell whose quota they are spending.

### D5 — Invite-only registration (confirmed by user)

Open signup is off by default. The admin provisions accounts or issues invite
codes from the admin area, with an "allow registration" toggle available.

Rationale: a `shared` provider config plus open signup on a public instance
means anyone who registers can spend the operator's API credits.

Per-user token usage accounting is explicitly deferred to a later phase. The
schema should leave room for it but phase 1 does not meter.

### D6 — Better Auth instead of Auth.js (proposed, pending user confirmation)

The original stack bundle named Auth.js. Research contradicts that choice.

Evidence:
- `next-auth` `latest` dist-tag is `4.24.15` — the legacy Pages Router line.
  The App Router-native v5 is still `beta` at `5.0.0-beta.32`.
- `better-auth` is at a stable GA `1.7.2`.

Fit against constraints already decided:
- D2 rule 3 requires `Authorization: Bearer` alongside cookies. Better Auth
  ships a first-party bearer plugin; Auth.js is cookie-session centric and
  needs workarounds.
- D4/D5 require admin/user roles and admin-provisioned accounts. Better Auth
  ships an admin plugin covering roles and user management.
- Self-hosting favors email+password with no mandatory third-party OAuth
  dependency, which Better Auth supports natively.
- Drizzle adapter is first-party.

### D7 — Remaining technical choices (proposed, pending user confirmation)

| Area | Choice | Why |
|---|---|---|
| API shape | REST Route Handlers under `app/api/**` | D2 rule 1; tRPC procedures are not plain HTTP endpoints, which complicates non-TS and future third-party clients |
| Validation | Zod schemas at the Route Handler boundary | One parse point; inferred types flow into the service layer |
| Package manager | pnpm | Lockfile determinism for reproducible self-host builds |
| Unit tests | Vitest | Native ESM/TS, aligns with Vite tooling |
| E2E | Deferred past phase 1 | Keeps MVP scope honest |

## Version matrix (verified against npm on 2026-08-31)

| Package | Version | Note |
|---|---|---|
| `next` | 16.3.3 | App Router |
| `react` | 19.2.8 | shipped with Next 16 |
| `typescript` | — | pin at scaffold time |
| `tailwindcss` | 4.3.3 | v4 config-in-CSS |
| `drizzle-orm` | 0.45.2 | |
| `drizzle-kit` | 0.31.10 | migrations |
| `ai` | 7.0.85 | core SDK |
| `@ai-sdk/react` | 4.0.88 | pairs with `ai@7`; peer `react ^19.2.1` |
| `@ai-sdk/openai` | 4.0.52 | |
| `@ai-sdk/anthropic` | 4.0.46 | |
| `@ai-sdk/google` | 4.0.58 | |
| `ollama-ai-provider-v2` | 4.0.1 | local-model path for self-hosters |
| `better-auth` | 1.7.2 | GA |
| `zustand` | 5.0.15 | |
| `zod` | 4.5.4 | |
| `vitest` | 4.1.11 | |

Naming trap worth remembering: the `ai` package major and the `@ai-sdk/*`
package majors are offset. `ai@7` pairs with `@ai-sdk/react@4` and
`@ai-sdk/<provider>@4`. `@ai-sdk/react` also publishes `ai-v5` / `ai-v6`
dist-tags for older cores — do not resolve these by matching major numbers.
