# Hook Guidelines

> Query hooks, mutations, `useChat`, and rules for custom hooks.

---

## Naming and placement

`useCamelCase` exported from `use-kebab-case.ts`. Domain hooks live in the
domain's component folder; `hooks/` is for hooks a second domain actually
needs. See [Directory Structure](./directory-structure.md).

---

## Data fetching

All server data goes through TanStack Query. Never `useEffect` + `fetch` — it
loses caching, deduplication, retry, and error state, and it renders an empty
flash on every mount.

Wrap each resource in a named hook rather than calling `useQuery` in
components. One definition of the key and the fetcher means the cache actually
hits, and invalidation has one correct target.

```ts
export function useTopics() {
  return useQuery({
    queryKey: topicKeys.list(),
    queryFn: () => api.topics.list(),
  });
}
```

**Query keys come from a per-domain factory**, never inline literals:

```ts
export const topicKeys = {
  all: ["topics"] as const,
  list: () => [...topicKeys.all, "list"] as const,
  detail: (id: string) => [...topicKeys.all, "detail", id] as const,
};
```

Inline keys drift by a character and silently produce a second cache entry —
the resulting "my update didn't show up" bug is expensive to find.

Fetchers live in `lib/api/`, typed by the shared Zod schemas, and parse the
response. A hook does not build URLs or read `response.json()` itself.

---

## Mutations

`useMutation` plus explicit invalidation of the affected keys in `onSuccess`.

Use optimistic updates only where the latency is actually felt — renaming a
topic, toggling a setting. Optimistic updates need a rollback path in
`onError`, and that is code to maintain; do not add it reflexively.

---

## Chat streaming

`useChat` from `@ai-sdk/react` owns the in-flight conversation. Do not
reimplement streaming with manual fetch and reader loops.

Rules:

- The chat endpoint is a Route Handler. Never a Server Action — see the
  constraints in `.trellis/spec/backend/index.md`.
- Persisted history loads through a normal query hook and seeds `useChat`'s
  initial messages. `useChat` holds the live turn; the server holds the truth.
- Handle `error` and `status` explicitly. A stream can fail after tokens have
  rendered, and it will look like the model stopped mid-sentence if unhandled.
- Stopping is a user action with a server side to it. Do not treat unmount or
  navigation as a stop — those are disconnects, and the answer should survive
  them.
- Keep the transport configurable rather than hardcoding global `fetch`. A
  future React Native client passes `expo/fetch` here, and that is the whole
  cost of reusing this layer on mobile.

---

## Custom hook rules

- One responsibility. A hook that fetches, transforms, and owns UI state is
  three hooks.
- Return an object, not a positional tuple, past two values.
- No conditional hook calls, no hooks in loops. Lint enforces this; do not
  argue with it.
- A hook that takes no arguments and returns nothing is usually an effect that
  belongs in the component.
- Do not wrap a query hook in another hook only to rename its fields.

---

## Memoization

Do not add `useMemo` or `useCallback` by default. They cost readability and
allocate on every render; most of the time they buy nothing.

Add them when there is a reason you can state: an expensive computation, a
dependency of another hook, or a prop to a memoized child. React Compiler
handles the common cases; hand-memoizing everything fights it.
