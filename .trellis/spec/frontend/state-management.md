# State Management

> Which state goes where. This is the single most consequential frontend
> convention in the project.

---

## The boundary

| Kind | Owner | Examples |
|---|---|---|
| Server state | TanStack Query | topics, assistants, messages, provider configs, the current user |
| Client state | Zustand | sidebar open, active model in the composer, theme, draft text |
| Ephemeral UI state | `useState` | input focus, a popover's open flag, hover |
| URL state | the route | current topic id, admin tab |

**The rule: server data is never copied into Zustand.**

Once the same fact lives in two stores, they diverge. The bug shows up as a
stale sidebar after a rename, and it is fixed by manual syncing code that then
has to be maintained forever. Query already owns caching, invalidation,
refetching, and staleness — a Zustand mirror throws all of that away and
reimplements it worse.

If a component needs server data, it calls the query hook. Even if that means
two components call the same hook — Query deduplicates, that is what the shared
key is for.

---

## Choosing a home

Try in this order and stop at the first that fits:

1. **Can it be derived?** Then derive it. Do not store what you can compute.
2. **Does it belong in the URL?** Anything a user should be able to link to,
   refresh into, or reach with the back button. The current topic is URL state,
   not store state.
3. **Is it server data?** Query.
4. **Is it used by one component subtree?** `useState`, lifted only as far as
   needed.
5. **Is it genuinely global client state?** Zustand.

Most state that reaches step 5 is actually step 2 in disguise. Check again.

---

## Zustand conventions

One store per concern, in `stores/<concern>-store.ts`. Not one global store —
a single store means every consumer re-renders on every unrelated change.

Select narrowly. Subscribing to the whole store re-renders on every field:

```ts
// Good — re-renders only when sidebarOpen changes
const sidebarOpen = useUiStore((s) => s.sidebarOpen);

// Bad — re-renders on every store change
const { sidebarOpen } = useUiStore();
```

Actions live in the store next to the state they mutate, so a state transition
has one implementation rather than being reassembled at each call site.

Persist deliberately. If a store is persisted to `localStorage`, it needs a
version and a migration path — a shape change against persisted data yields a
white screen on upgrade, in a self-hosted product where you cannot clear the
user's storage for them.

---

## Server state that feels like client state

Two cases come up constantly in this product and both belong to Query:

**The selected model in the composer.** The *list* of available models is
server state — it is derived from provider configs and changes when an admin
edits one. The user's current pick is client state. Do not cache the list in
Zustand to avoid a refetch; if an admin revokes a shared provider, a stale
cached list lets the user select a model that will fail.

**The current user and role.** Server state. Fetch it with a query hook.
Mirroring the role into a store is how a client-side admin check ends up
reading a stale value — and a client-side admin check was never the real
enforcement anyway. See `.trellis/spec/backend/database-guidelines.md`.

---

## Forbidden

- Server data in Zustand.
- A single application-wide store.
- `useStore()` without a selector in a frequently rendering component.
- Context as a state manager for frequently changing values — every consumer
  re-renders. Context is fine for stable values like theme or a client
  instance.
- Storing derived values that could be computed from existing state.
