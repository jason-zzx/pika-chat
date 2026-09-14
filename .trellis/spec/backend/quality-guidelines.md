# Quality Guidelines

> Standards backend code is held to, and the patterns that get changes sent
> back.

---

## Commands

```bash
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
```

All three must pass before a task is reported complete. "It runs" is not the
bar.

---

## TypeScript

`strict: true`, and additionally `noUncheckedIndexedAccess`. Array and record
access lies about safety without it, and this codebase indexes into
provider/model maps constantly.

Forbidden:

- `any` — use `unknown` and narrow.
- Non-null assertion `!` — if it cannot be null, the type is wrong; if it can,
  handle it.
- `as` casts to silence the compiler. Casting is allowed only to narrow a
  genuinely opaque `unknown` immediately after a runtime check.
- `@ts-ignore`. `@ts-expect-error` with a one-line reason is acceptable when a
  dependency's types are wrong.

---

## Testing

Vitest. The service layer is the primary target — that is where the business
rules live, and the signature rule from
[Directory Structure](./directory-structure.md) makes services testable with no
HTTP mocking.

Tests are required for:

- Authorization decisions. Every rule in
  [Database Guidelines](./database-guidelines.md) that says "enforced
  server-side" needs a test proving a non-admin cannot do the admin thing.
  Specifically: a regular user POSTing `visibility: "shared"` must end up with
  `private`.
- Ownership isolation. User A must not be able to read user B's topic.
- Model resolution. The union of shared and own configs, including the case
  where both offer the same model id.
- Anything fixed after a bug. The regression test is part of the fix, not a
  follow-up.

Not required: thin Route Handlers that only parse-delegate-respond, Drizzle
schema definitions, generated code.

Do not mock the thing under test. Mock the network boundary — the LLM provider
call — and let the database be real in integration tests.

**Integration tests must never reach real object storage.** The database is
isolated per run (`TEST_DATABASE_URL`), but `getFileStorage()` reads the same
`S3_*` env as production — unmocked, an integration test writes fixture objects
into the operator's real bucket (this actually happened: hundreds of leftover
objects in a user's rustfs bucket, 2026-09-14). The integration project's
setup (`vitest.integration.storage.ts`) replaces `getFileStorage()` with a
shared in-memory `InMemoryFileStorage` (`src/test-utils/in-memory-file-storage.ts`)
and asserts after every test that the fake is empty — a leaked object fails the
suite, not the deployment. A file-level `vi.mock` overrides the setup mock
where a test genuinely needs a hybrid stub (the direct-upload tests do this
for presign URLs); that override is the documented escape hatch, not a
precedent for skipping the fake.

E2E is deferred past phase 1. Do not add a Playwright suite without deciding
that as a scoped piece of work.

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| `console.log` in `src/server/**` | Bypasses levels and redaction. Use the pino logger. |
| Business logic in a Route Handler | Untestable without HTTP, unreachable from a second transport. |
| `db` access outside `src/server/db` consumers | Breaks the layer boundary. |
| Authorization only in the UI or only in the handler | The next caller skips it. |
| Server Action as the sole path to a capability | Closes the mobile door — see [index.md](./index.md). |
| Catch-and-swallow (`catch {}`) | Turns a bug into a mystery. Log it or rethrow it. |
| Secrets in error messages or logs | See [Logging Guidelines](./logging-guidelines.md). |
| Editing an applied migration | Diverges deployed databases from the repo. |

---

## Review focus

When reviewing backend changes, read in this order — it front-loads the things
that are expensive to fix later:

1. Authorization and ownership filters.
2. Layer boundaries: did logic leak into the handler, did HTTP leak into a
   service?
3. Migration correctness from an empty database.
4. Secret and message-content handling in logs and error responses.
5. Then style and naming.
