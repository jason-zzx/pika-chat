# Backend Development Guidelines

> Server-side conventions for pika-chat: Route Handlers, service layer,
> Drizzle/PostgreSQL, and auth.

---

## Status of this spec

**Scaffold landed (`08-31-scaffold`); auth landed (`08-31-auth-users`).**
Conventions were written greenfield and the first tree was built to match
them. Source of the original decisions:
`.trellis/tasks/00-bootstrap-guidelines/research/tech-stack-decision.md`.

Divergences recorded after the scaffold:

- `src/server/db/schema/**` does **not** import `server-only`. drizzle-kit
  loads these files in a plain Node process that does not rewrite the
  `server-only` package, so the guard would make `pnpm db:generate` unusable.
  Every other module under `src/server/` still starts with `import "server-only"`.
- Route groups `(auth)` / `(app)` and `admin/` exist in this layout as the
  map for later tasks; the scaffold only creates a directory when it places a
  real file. `08-31-auth-users` placed the auth and admin route files.

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router, Node runtime |
| Language | TypeScript, strict |
| Database | PostgreSQL |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Auth | Better Auth (database session + bearer plugin + admin plugin) |
| LLM | Vercel AI SDK (`ai@7`, `@ai-sdk/*@4`) |
| Validation | Zod at the transport boundary |
| Logging | pino |
| Tests | Vitest |

Do not resolve AI SDK versions by matching major numbers — `ai@7` pairs with
`@ai-sdk/react@4` and `@ai-sdk/<provider>@4`.

---

## The four constraints that outrank convenience

This product intends to ship a native mobile client in a later phase. Four
rules keep that door open at near-zero cost today. Violating any of them is a
review blocker, not a style nit.

1. **Every business capability is reachable as an HTTP Route Handler** under
   `src/app/api/**`. A native client can call a Route Handler; it cannot call a
   Server Action or render an RSC.
2. **Server Actions are not used for business logic.** See
   [Directory Structure](./directory-structure.md) for the narrow exceptions.
3. **Auth accepts `Authorization: Bearer` as well as the session cookie.**
4. **Conversation state is server-authoritative.** The client is never the only
   holder of a message.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Layering, where code goes, the transport/domain split |
| [Auth Guidelines](./auth-guidelines.md) | Actor contract, headerless `createUser`, cookie-cache prohibition, adding a Better Auth plugin (schema → migration → adapter map → client), TOTP 2FA contract and its cookie-bound challenge |
| [Database Guidelines](./database-guidelines.md) | Drizzle schema, migrations, ownership isolation, credential encryption |
| [Error Handling](./error-handling.md) | Typed errors, boundary translation, streaming failures |
| [Chat Message Metadata](./chat-message-metadata.md) | Cross-layer per-message metadata contract: schema, columns, live-stream vs persisted, early `message-metadata` emit |
| [Chat Message Versions](./chat-message-versions.md) | Regenerate-as-versions contract: group_id/is_selected, selected-version view, regenerate/select/delete endpoints, reseed rule |
| [Chat History Compression](./chat-history-compression.md) | Rolling summary + inclusive boundary on `topics`, token heuristic + 80% threshold, `historySummary` injection, both streaming routes must trim, failure degrades |
| [Chat Message Translation](./chat-message-translation.md) | Per-message-version `translations` jsonb map, cache-first `/api/translate`, key-merge persistence, shared language list |
| [Chat Attachments](./chat-attachments.md) | File upload/download/delete endpoints, `files` table, local-disk `FileStorage`, extraction cache, capability routing (`inputModalities`) and the `Errors.file.*` matrix |
| [Chat Search Tools](./chat-search-tools.md) | Search provider settings, searchWeb tool + fallback chain, searchMode wiring, builtin fetch injection, tool-part persistence/replay/rendering |
| [Provider Configs](./provider-configs.md) | Endpoint `apiFormat` (openai-compatible / claude / google), the api-key requirement rule, per-format provider construction + discovery, `addProviderModel` optional metadata overrides vs catalog fill, `metadataSource` marking, `vendorKey` null-vs-undefined |
| [Topic Favorites](./topic-favorites.md) | `topics.is_favorite` column, PATCH favorite endpoint, `topics.updatedAt` last-active semantics (which mutations may bump it) |
| [Logging Guidelines](./logging-guidelines.md) | Structured logs, levels, redaction |
| [Quality Guidelines](./quality-guidelines.md) | Lint, types, tests, forbidden patterns |

---

## Pre-Development Checklist

Work through this before writing backend code.

- [ ] Which layer does this change belong to — Route Handler, service, or data?
      Do not let logic drift up into the handler.
- [ ] Does this add a capability? If so, it needs a Route Handler, not only a
      Server Action or RSC-only path.
- [ ] Does the service function signature stay free of `NextRequest`,
      `NextResponse`, `cookies()`, and `headers()`?
- [ ] Does every query touching user-owned data filter by the caller's user id?
- [ ] Is any new authorization rule enforced server-side, not just hidden in UI?
- [ ] Is there a Zod schema for every request body and query string this adds?
- [ ] Does anything new need a Drizzle migration? Is it generated, not
      hand-written after the fact?
- [ ] Will any secret, API key, or message body reach a log line?

## Quality Check

Run through this before declaring backend work done.

- [ ] `pnpm lint` and `pnpm typecheck` pass.
- [ ] `pnpm test` passes; new service-layer logic has Vitest coverage.
- [ ] No `any`, no non-null `!` assertion, no unchecked `as` cast added.
- [ ] Every new endpoint validates its input with Zod and returns the project's
      error shape on failure.
- [ ] Authorization was verified by reading the service function, not the UI.
- [ ] Ownership filters present on every user-scoped query.
- [ ] Migrations committed alongside the schema change and apply cleanly from
      an empty database.
- [ ] Secrets and message content absent from logs.
- [ ] No Server Action added for a capability that a mobile client would need.

---

**Language**: spec files are written in English.
