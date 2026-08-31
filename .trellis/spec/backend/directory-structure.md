# Directory Structure

> How server-side code is organized, and where the layer boundaries sit.

---

## Layout

```
src/
├── app/
│   ├── (auth)/                     # login, invite acceptance — unauthenticated
│   ├── (app)/                      # authenticated product surface
│   ├── admin/                      # admin-only surface
│   └── api/
│       ├── auth/[...all]/route.ts  # Better Auth catch-all
│       ├── chat/route.ts           # streaming completion
│       ├── providers/              # provider + model configuration
│       ├── assistants/
│       ├── topics/
│       └── admin/                  # admin-only endpoints
├── server/                         # server-only; never imported by a client component
│   ├── services/                   # business logic, one module per domain
│   ├── db/
│   │   ├── schema/                 # Drizzle tables, one file per domain
│   │   ├── client.ts               # db connection
│   │   └── migrations/             # drizzle-kit output, committed
│   ├── auth/                       # Better Auth config, session resolution
│   ├── ai/                         # provider registry, model catalog + resolution
│   └── logger.ts
├── lib/                            # isomorphic pure helpers, no io, no secrets
└── types/
```

Add `import "server-only"` at the top of every module under `src/server/`. It
turns an accidental client import into a build error instead of a leaked secret.

---

## The three layers

| Layer | Lives in | May do | Must not do |
|---|---|---|---|
| Transport | `app/api/**/route.ts` | parse, authenticate, authorize entry, call one service, shape the response | contain business rules, touch the db directly |
| Domain | `server/services/**` | business rules, orchestration, db access via repositories or Drizzle | know about HTTP, read cookies, return `Response` |
| Data | `server/db/**` | schema, migrations, query building | make authorization decisions |

### The signature rule

A service function must not mention Next.js in its signature. This is the
mechanical test for whether the layering held.

```ts
// Good — callable from a Route Handler today, from a v2 mobile API later,
// and from a Vitest test with no HTTP mock.
export async function createTopic(
  input: CreateTopicInput,
  actor: Actor,
): Promise<Topic> { /* ... */ }
```

```ts
// Bad — now welded to one transport.
export async function createTopic(req: NextRequest): Promise<NextResponse> { /* ... */ }
```

`Actor` carries the authenticated user id and role. Services receive it as a
parameter; they never resolve it themselves from ambient request state.

### Route Handler shape

Handlers stay boring and uniform:

```ts
export async function POST(req: Request) {
  const actor = await requireActor(req);          // throws AppError on 401
  const input = createTopicSchema.parse(await req.json());
  const topic = await topicService.createTopic(input, actor);
  return Response.json(topic, { status: 201 });
}
```

Parse, authenticate, delegate, respond. If a handler grows a conditional that
encodes a business rule, that rule belongs in the service.

---

## Server Actions

Server Actions are **not** an acceptable home for business logic, because a
native mobile client cannot invoke one. See the four constraints in
[index.md](./index.md).

Permitted narrowly for progressive-enhancement form posts whose capability is
*also* exposed as a Route Handler. If you find yourself writing a Server Action
that is the only way to perform an operation, stop and write the Route Handler
instead.

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Route Handler file | Next.js mandated | `app/api/topics/route.ts` |
| Service module | `<domain>.service.ts` | `server/services/topic.service.ts` |
| Schema file | `<domain>.ts` | `server/db/schema/topic.ts` |
| Zod schema | `<verb><Noun>Schema` | `createTopicSchema` |
| Inferred input type | `<Verb><Noun>Input` | `CreateTopicInput` |
| Table (SQL) | `snake_case`, plural | `chat_messages` |
| Drizzle export | `camelCase`, plural | `chatMessages` |

---

## Common Mistakes

- Putting a permission check only in the Route Handler. The next caller of that
  service skips it. Authorization belongs in the service.
- Importing a `server/` module from a client component. Prevented by
  `server-only`, but the fix is to move the shared type into `types/`, not to
  remove the guard.
- Letting a service return an HTTP status. Services throw typed errors; the
  boundary maps them. See [Error Handling](./error-handling.md).
- Reaching for `db` directly inside a Route Handler "just for a quick read".
  Quick reads become joined reads with business rules three commits later.
