# Backend Development Guidelines

> Server-side conventions for pika-chat: Route Handlers, service layer,
> Drizzle/PostgreSQL, and auth.

---

## Status of this spec

**Greenfield.** These are committed conventions agreed before the first line of
code, not observations of existing code. Source of the decisions:
`.trellis/tasks/00-bootstrap-guidelines/research/tech-stack-decision.md`.

Once `08-31-scaffold` lands, re-read these files against the real tree and
correct anything the implementation legitimately diverged on. Until then, treat
them as binding: the scaffold is expected to match this spec, not the reverse.

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router, Node runtime |
| Language | TypeScript, strict |
| Database | PostgreSQL |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Auth | Better Auth (JWT session + bearer plugin + admin plugin) |
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
| [Database Guidelines](./database-guidelines.md) | Drizzle schema, migrations, ownership isolation, credential encryption |
| [Error Handling](./error-handling.md) | Typed errors, boundary translation, streaming failures |
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
