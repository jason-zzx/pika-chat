# Quality Guidelines

> Standards frontend code is held to.

---

## Commands

```bash
pnpm lint         # eslint, including react-hooks and jsx-a11y
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
```

All three pass before frontend work is reported complete.

---

## Lint

`eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y` are enabled and their
findings are not negotiable. The hooks rules catch real dependency bugs; the
a11y rules catch the icon-button-without-a-label problem this UI is prone to.

Disable a rule inline only with a reason on the line above, and only for a
single line.

---

## Testing

Vitest with Testing Library. Test behavior a user can observe, not
implementation.

Worth testing:

- Conditional rendering that encodes a rule — for example, that a regular user
  never sees the "share this provider" control. (The real enforcement is
  server-side; this test guards the UX, not the security boundary.)
- Components with non-trivial derived state, such as the model picker resolving
  shared and personal providers into one list with visible provenance.
- Anything fixed after a bug.

Not worth testing: presentational components with no logic, shadcn/ui
primitives, snapshot tests of markup. Snapshots fail on every legitimate change
and get regenerated without reading — they cost attention and catch nothing.

Mock at the network boundary with MSW or a stubbed API client, not by mocking
the query hooks. Mocking the hook under test means the test passes when the
hook is wrong.

---

## Accessibility

Baseline, enforced in review:

- Keyboard reachable, with visible focus.
- Icon-only buttons labelled.
- Form inputs associated with labels.
- Sufficient contrast in both themes — check dark mode explicitly, it is where
  contrast regressions hide.
- Streaming output announced through a throttled live region, not per token.
- `prefers-reduced-motion` respected.

---

## Performance

Do not optimize speculatively. Do avoid the known-expensive mistakes:

- Keep `"use client"` at the leaves. Bundle size is the main lever here.
- Select narrowly from Zustand.
- Long message lists need windowing once they are actually long — measure
  first, then add it.
- Streaming re-renders on every token. Keep the streaming message's subtree
  small, and do not put expensive rendering (heavy markdown, syntax
  highlighting) in the path without memoizing on the settled content.
- `next/image` for images; no raw `<img>` for anything sized.

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| `"use client"` on a page or layout | Ships the whole subtree to the browser |
| `useEffect` + `fetch` for server data | Loses caching, dedup, retry, error state |
| Server data mirrored into Zustand | Guaranteed divergence — see [State Management](./state-management.md) |
| Hand-written type mirroring a server response | Compiles while wrong — see [Type Safety](./type-safety.md) |
| Inline query keys | Silent duplicate cache entries |
| Hardcoded colors | Dark-mode bugs |
| `<div onClick>` | Not focusable, not keyboard accessible |
| Snapshot tests of markup | Fail on every real change, catch nothing |

---

## Review focus

1. Server/client boundary — is `"use client"` as low as it can go?
2. State placement — is any server data living in a store?
3. Type contracts — inferred from shared schemas, or hand-written?
4. Both breakpoints, including that mobile navigation works.
5. Accessibility basics.
6. Then style and naming.
