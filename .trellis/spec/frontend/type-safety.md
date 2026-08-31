# Type Safety

> How types cross the client/server boundary, and the escapes that are not
> allowed.

---

## Compiler settings

`strict: true` plus `noUncheckedIndexedAccess`. The latter matters here because
the model and provider maps are indexed constantly, and without it `map[id]` is
typed as present when it may not be.

---

## One contract, shared

The API contract is a Zod schema in `lib/schemas/`, imported by both the client
and the Route Handler. Types are **inferred** from the schema, never written
twice.

```ts
// lib/schemas/topic.ts — the single source of truth
export const topicSchema = z.object({
  id: z.string(),
  title: z.string(),
  assistantId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Topic = z.infer<typeof topicSchema>;

export const createTopicSchema = topicSchema.pick({ title: true, assistantId: true });
export type CreateTopicInput = z.infer<typeof createTopicSchema>;
```

The server validates requests with `createTopicSchema`; the client types its
fetcher with `CreateTopicInput` and parses responses with `topicSchema`. A
field renamed on the server becomes a client type error immediately, which is
the entire point.

A hand-written `interface Topic` mirroring a server response is forbidden. It
compiles happily while being wrong.

---

## Parse at the edge

`fetch` returns `any` in practice. Parse the response with the schema in
`lib/api/`, and let typed data flow inward from there.

```ts
export async function getTopic(id: string): Promise<Topic> {
  const res = await http.get(`/api/topics/${id}`);
  return topicSchema.parse(res);
}
```

Parsing at the edge means a server contract change surfaces as a clear parse
error at the boundary, rather than as `undefined is not an object` three
components deep.

Parse once. Components downstream trust their props.

---

## Forbidden escapes

| Escape | Instead |
|---|---|
| `any` | `unknown`, then narrow |
| `!` non-null assertion | handle the null, or fix the type that is lying |
| `as SomeType` to silence an error | parse it, or narrow it with a real check |
| `@ts-ignore` | `@ts-expect-error` with a one-line reason, only for wrong dependency types |
| hand-written mirror of a server type | infer from the shared Zod schema |
| `object` / `Function` | a specific shape or signature |

`as const` is not a cast in this sense and is encouraged, especially for query
key factories.

---

## Discriminated unions over optional soup

A type with several mutually exclusive optional fields is usually a union
wearing a disguise. Message parts, provider configurations, and load states all
model better as discriminated unions — the compiler can then prove the switch
is exhaustive.

```ts
type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; error: AppError }
  | { status: "ready"; data: T };
```

Use a `never`-typed default branch so adding a variant becomes a compile error
at every switch that handles it.

---

## Nullability

Model "absent" one way per field and stick to it. A field that is sometimes
`null`, sometimes `undefined`, and sometimes `""` produces three checks at
every call site and a bug wherever one is missed.

Convention: `null` for "known to be absent" from the database, `undefined` for
"not provided" in inputs. Never empty string as a sentinel.
