# Component Guidelines

> The server/client boundary, composition, responsive layout, and
> accessibility.

---

## Server Components by default

Every component is a Server Component unless it needs state, effects, event
handlers, or a browser API. `"use client"` is an opt-in, and it is contagious —
everything imported by a client component is pulled into the client bundle too.

**Push the boundary down to the leaf.** A page that is mostly static with one
interactive control should be a Server Component rendering a small client
component, not a client page.

```tsx
// Good — the page stays server-rendered, only the composer ships JS.
export default async function TopicPage({ params }) {
  const topic = await getTopic(params.topicId);
  return (
    <>
      <TopicHeader topic={topic} />
      <MessageList messages={topic.messages} />
      <Composer topicId={topic.id} />   {/* "use client" lives here */}
    </>
  );
}
```

```tsx
// Bad — "use client" at the page drags the whole subtree into the bundle.
"use client";
export default function TopicPage() { /* ... */ }
```

Passing a Server Component as `children` to a client component keeps it on the
server. Use that instead of converting a wrapper's subtree.

---

## Component structure

One component per file, default export, name matching the filename.

Order within a file: types, then the component, then any file-local subcomponent.
Hooks come first inside the component body, then derived values, then handlers,
then the return.

Keep a component in one screenful where practical. When it stops fitting, the
usual cause is one component doing both data orchestration and presentation —
split along that seam.

---

## Props

- Define props with a `type`, not an `interface`, and do not export it unless
  another module genuinely needs it.
- No prop spreading (`{...props}`) onto domain components. It hides the
  contract. Spreading onto a `ui/` primitive wrapper is fine.
- Booleans are named for the state, not the negation: `disabled`, not
  `notEnabled`.
- A component takes data, not fetchers. Data loading belongs in a hook or a
  Server Component above it — see [Hook Guidelines](./hook-guidelines.md).

---

## Styling

Tailwind 4, configured in `globals.css` via `@theme` — there is no
`tailwind.config.js` in v4. Colors, spacing, and fonts are defined as theme
tokens there.

- Compose class names with `cn()` from `lib/utils.ts`. It merges conflicting
  Tailwind classes correctly, which naive template strings do not.
- Use theme tokens, not raw hex values. Dark mode depends on tokens resolving
  differently; a hardcoded color is a dark-mode bug.
- No inline `style` except for genuinely dynamic values a class cannot express.
- Reach for a shadcn/ui primitive before writing a new one.

---

## Responsive layout

PC and mobile are both first-class. This is a product requirement, not a
progressive enhancement.

**Mobile-first**: unprefixed classes describe the mobile layout, `md:` and
above adjust for desktop. Writing desktop first and patching mobile with
overrides produces specificity fights.

The two layouts differ structurally, not only in size: desktop shows the topic
sidebar persistently alongside the conversation, mobile puts it behind a
drawer. Express that with a single component tree that reflows where possible.
Rendering two parallel trees and toggling with `hidden md:block` doubles the
DOM, duplicates state, and is where the two layouts start behaving differently.

Where a genuine structural fork is unavoidable, keep the shared state above the
fork so both branches read the same source.

Test both breakpoints before calling a component done, and specifically test
that the mobile drawer opens, closes, and closes again after navigation.

---

## Accessibility

- Semantic elements first. A `<div onClick>` is not a button — it is not
  focusable, not keyboard activatable, and not announced.
- Every interactive element is keyboard reachable, with a visible focus style.
- Icon-only buttons need an `aria-label`. The chat UI is full of them.
- The message list needs an accessible live region so streaming responses are
  announced, but throttled — announcing every token is unusable.
- Respect `prefers-reduced-motion` for streaming and transition animations.

---

## Common Mistakes

- `"use client"` on a layout or page "to make it work". It works, and it ships
  the entire subtree to the browser.
- Fetching in a `useEffect` instead of using a query hook. It loses caching,
  deduplication, and error handling, and it flashes empty content.
- Duplicating server data into local state to make it editable. See
  [State Management](./state-management.md).
- Hardcoded colors that look fine until dark mode is enabled.
- Building the desktop layout first and treating mobile as cleanup, which is
  how mobile ends up with an unreachable control.
