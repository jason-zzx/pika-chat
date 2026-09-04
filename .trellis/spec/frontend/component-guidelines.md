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

## Popup positioning

Base UI `Positioner` defaults to `positionMethod: "absolute"`: the portal
wrapper renders as `position: absolute; top: 0; left: 0` plus
`transform: translate(x, y)`, and its scrollable overflow participates in the
document scroll area. A popup anchored near the bottom of the viewport then
grows `documentElement.scrollHeight` and a page scrollbar appears even though
the popup itself fits — measured on the chat composer, opening the model
picker grew the document from 800 to 806 px.

**Convention**: every shared popup wrapper passes `positionMethod="fixed"` —
`ui/popover.tsx`, `ui/select.tsx`, `ui/dropdown-menu.tsx`, `ui/tooltip.tsx`.
Fixed boxes never contribute to document scroll, and floating-ui keeps them
glued to the trigger while the page scrolls. New popup wrappers must do the
same. This is the one sanctioned hand edit inside the generated
`components/ui/` territory (recorded in the index "Status of this spec").

#### Wrong

```tsx
<PopoverPrimitive.Positioner className="isolate z-50">
```

#### Correct

```tsx
<PopoverPrimitive.Positioner positionMethod="fixed" className="isolate z-50">
```

---

## Hover-reveal rows

Chat message meta rows (timestamps, message actions) are always mounted with a
fixed height and fade in on hover of the whole message — never conditionally
mounted, which shifts the layout under the pointer exactly when the user aims
at the row. Scope the hover to one message with a named group so nested groups
do not collide, and include `group-focus-within` so keyboard users can reach
and see the icon-only buttons (a11y rule above).

**Convention** (from `chat/MessageTimestamp.tsx` / `chat/MessageActions.tsx`,
landed in `09-04-chat-message-meta`): the message `<article>` carries
`group/message`; every reveal row renders unconditionally with

```tsx
"h-5 shrink-0 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/message:opacity-100 group-focus-within/message:opacity-100 group-data-[revealed=true]/message:opacity-100"
```

The class string is duplicated across the reveal rows on purpose — three
occurrences still beat a shared wrapper here. Content that can be absent (a
message without a recorded timestamp) may return `null`; rows whose existence
is data-driven do not need phantom placeholders.

**Tap reveal (touch has no hover; landed in
`09-04-chat-message-regenerate-delete`)**: tapping a message body reveals its
meta rows by setting `data-revealed` on the article. The state is
*single-active*: `MessageList` owns one `revealedKey` and a tap only ever
sets it — never toggles off — so at most one message is revealed and it stays
revealed until a different message is tapped. Key the state (and the React
element key) by `metadata.groupId ?? message.id`, never by the per-version
message id: switching versions swaps in a different-id row, and id-keying
remounts the item and drops the reveal. Ignore taps on nested
buttons/links and non-collapsed text selections. Opening a portaled dropdown
or showing transient copy feedback must also force the row visible (both
drop focus/hover from the article), so those states lift into the reveal
condition. Desktop hover/focus-within stays instantaneous and independent of
the tap state.

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
- Calling `navigator.clipboard.writeText` directly: the API is absent on
  insecure contexts (http over a LAN IP, e.g. testing from a phone) and the
  copy silently fails. Use `copyTextToClipboard` (`src/lib/clipboard.ts`),
  which falls back to a hidden textarea + `execCommand("copy")` and reports
  failure only when both paths fail.
- Assuming `history.replaceState` navigates: it rewrites the URL without
  re-rendering the route, so route props (e.g. `topicId`) stay stale. State
  that depends on the effective id must derive it (`topicId ?? createdId`)
  rather than reading the route prop alone.
- A search field inside a Dialog `<form>` (`ModelPicker`,
  `AssistantEmojiPicker`): Enter submits Save unless that key is
  `preventDefault`ed on the popover.
- Copying Radix `PopoverTrigger asChild` from upstream docs. This repo's
  popover is Base UI — use `render={<Button type="button" … />}` like
  `ModelPicker`. Generated `components/ui/emoji-picker.tsx` is Frimousse via
  the shadcn CLI; compose it, do not restyle by hand.
- Adding a popup wrapper without `positionMethod="fixed"`. The absolute
  default grows the document and shows a page scrollbar when the trigger sits
  near the viewport bottom — see Popup positioning above.
