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

### Settings surfaces

Every `/settings/*` page composes the shared primitives in
`src/components/settings/` instead of ad-hoc cards:

- `SettingsCard` — the single surface (`rounded-xl border bg-card shadow-xs`);
  padding belongs to the consumer (forms pad the card, row layouts divide
  internally with `divide-y`).
- `SettingsSection` — titled group (`title` + optional `description`) above a
  card or list; replaces bare `<h2>` section headers.
- `SettingsRow` — label/description left, control right; stacks on mobile.
- `SettingsBadge` — status pill where a dot carries the tone (`neutral` /
  `success` / `destructive`); pass `dot={false}` for category tags (roles,
  visibility) that carry no status.

Status color: the theme is deliberately monochrome; `--success` (declared in
`globals.css` for light and dark) is the only accent, reserved for "on/open"
state dots. Do not introduce further status colors without a spec discussion.

Entity management on settings pages is dialog-first: creation and editing
happen in modal `Dialog`s (`ProviderConfigForm`, `ModelEditorDialog`,
`ProviderFormDialog`, admin user dialogs), never in inline stacked forms.
Lists with per-item detail use a master-detail layout instead of stacked
cards, and destructive actions (delete provider) go through a confirmation
dialog before mutating.

`DialogFooter` is deliberately flat: no top border, no muted background —
the footer is a plain button row on the same surface as the content.

`src/components/ui/checkbox.tsx` is the styled checkbox primitive (base-ui
`Checkbox`); native `<input type="checkbox">` is not used in new UI.

### Providers master-detail

`/settings/providers` is the reference master-detail implementation:

- Full width: the page passes `className="max-w-none md:min-h-0"` to
  `PageContainer`; other settings pages keep `max-w-3xl`.
- Desktop (md+): fixed-height two-column grid
  (`md:grid-cols-[260px_minmax(0,1fr)]`) with an absolute full-height
  divider at `left-[276px]` (260px column + half the 2rem gap). The height
  chain — settings layout scroll container `flex flex-col`, `PageContainer`
  `flex-1`, screen root `flex-1`, grid `md:flex-1`, with `md:min-h-0` at
  every level — keeps the page itself from scrolling; each column scrolls
  internally (`md:overflow-y-auto`). `min-h-0` must stay `md:`-prefixed or
  mobile page scroll breaks.
- Mobile: two real pages. The list route renders the list only; selecting
  an entry `router.push`es `/settings/providers/[configId]`, which renders
  the detail only, with a back link. Column visibility derives from the
  route param (`selectedConfigId` prop) via `hidden md:flex` / `md:hidden`,
  never from a JS media query — desktop selection is local state and does
  not touch the URL.
- Model capability iconography is shared via
  `src/components/provider/model-capabilities.tsx`: eye = vision/image
  input (consistent with the chat `ModelPicker`), `BrainIcon` = reasoning,
  per-modality icons for audio/video/pdf. Reuse `ModalityIcon` /
  `ModelCapabilityIcons` instead of inventing new capability glyphs.

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

## Markdown rendering (Streamdown)

Assistant messages render through `chat/Markdown.tsx`, the single entry point
that wraps Streamdown; user bubbles stay plain text. Render markdown only
through that component — do not import `streamdown` elsewhere.

Contracts that are easy to break (from `09-07-chat-renderer-syntax-plugins`):

- **Plugins are opt-in and heavy.** Streamdown core ships GFM only; code
  highlighting (Shiki), math (KaTeX), mermaid, and CJK-friendly emphasis come
  from `@streamdown/*` packages. They are loaded via dynamic `import()` in
  `chat/markdown-plugins.ts` so they never enter the first-load chunk, and
  mermaid loads only when the text contains a mermaid fence. Keep it that way:
  a static plugin import is a bundle-size regression.
- **Plugin identity must be stable.** Streamdown's memo compares the `plugins`
  prop by reference; module-level promise caches in `markdown-plugins.ts`
  hand every message the same object. Creating plugins inline per render
  reparses every block on every render.
- **The memo comparator ignores the `mermaid` prop.** A rendered diagram keeps
  its baked-in theme across a dark/light toggle, so mermaid-containing
  messages pass a theme `key` to force remount. Do not key non-mermaid
  messages — that remounts (and reparses) every block on each theme toggle.
- Until plugins arrive, Streamdown renders its plain fallback; content stays
  readable and upgrades in place. Preserve that degraded path when touching
  the loader.
- **Inline citations** (landed in `09-07-web-search-tools` R14):
  `MessageItem` collects a `num → source` map from the message's tool
  parts and passes it to `Markdown` as `citations`. The `[n]` → chip
  transform is AST-level only (`remarkCitations` walks mdast text nodes;
  code/inline-code/html carry text in `value` and link/image subtrees are
  explicitly skipped — a whole-string regex would corrupt `a[1]`). Chips
  are `<sup>` buttons (`CitationSup`) opening `ExternalLinkDialog`;
  unresolvable markers render literally. A marker may name several nums in
  one bracket (`[3, 5]` — ASCII/fullwidth/ideographic comma, optional
  spacing): the whole group is one `sup` node and `CitationSup` emits one
  chip per resolvable num, back to back with no separator text between them,
  while unresolvable nums stay as their literal `[n]`. Plugin and renderer
  build their regexes from the single `CITATION_MARKER_SOURCE` in
  `citations.ts`, so they cannot disagree about what a marker is. Three
  non-obvious contracts:
  the remark plugin and components override are module-level constants
  (memo identity); sources travel via React context so late-arriving
  source maps propagate across Streamdown's memo boundary; and the
  remount key gains a `"cited"` segment when citations first appear —
  Streamdown's memo does NOT compare `remarkPlugins`/`components`, so
  without the key segment an already-rendered text block would never
  reparse and its markers would stay literal. The no-citations path keeps
  `key={undefined}` (never remounts) and byte-identical props.

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

## Cursor affordance

Every clickable control must show the pointer cursor. Native `<button>` renders
the default arrow in all major browsers, so a button-only UI reads as
non-interactive — this was the actual state of the chat UI (reasoning toggle,
model/assistant pickers, tool-call headers) until the fix landed.

**Convention** (two layers, in `src/app/globals.css` plus the ui primitives):

1. A `@layer base` rule in `globals.css` maps `cursor: pointer` onto every
   interactive control — `button:not(:disabled)`, plus the ARIA roles Base UI
   renders as divs (`option`, `menuitem`, `menuitemcheckbox`, `menuitemradio`,
   `checkbox`, `radio`, `switch`, `tab`, `combobox`, `button`). New raw
   `<button>`s and role-based items need no per-component cursor class.
2. Where a ui primitive class string carries `cursor-default` (utilities layer
   beats base), it is changed to `cursor-pointer` — currently 4 occurrences in
   `ui/dropdown-menu.tsx` and 3 in `ui/select.tsx` (items + scroll buttons).
   `ui/checkbox.tsx` additionally renders a minus icon for the indeterminate
   state via an Indicator render-prop hand edit. These are hand edits inside
   generated `components/ui/` territory (see "Popup positioning" for the
   first): a `shadcn` regen would silently revert them, so re-apply after any
   regen.

Semantic cursors keep winning: `:not(:disabled)` excludes disabled controls
(`disabled:cursor-not-allowed` on `ui/select.tsx` still applies), and explicit
utilities such as the `SidebarRail` resize cursors (`cursor-w-resize` /
`cursor-e-resize`) live in the utilities layer and override the base rule.
Anchors with `href` already point natively. Do **not** put `cursor: pointer` on
large content regions whose click is a secondary affordance (the message
`<article>` tap-to-reveal) — it poisons text-selection gestures.

#### Wrong

```tsx
// hoping the browser shows a pointer
<button type="button" onClick={toggle}>{label}</button>
```

#### Correct

```css
/* globals.css @layer base */
button:not(:disabled),
[role='menuitem']:not(:disabled),
/* ...full role list in globals.css... */ {
  cursor: pointer;
}
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

## Collapsible sidebar group labels

Sidebar sections whose content hides behind a click on the group label
("Favorite" / "Topics", landed in `09-09-topic-favorites`) follow the
`ToolCallShell` collapse mechanics (`chat/ToolCallShell.tsx`): chevron
`ChevronDownIcon` with `rotate-180` when open, `transition-transform
duration-200 motion-reduce:transition-none`, `aria-expanded` +
`aria-controls={useId()}`, and the `grid grid-rows-[1fr]`/`grid-rows-[0fr]` +
inner `min-h-0 overflow-hidden` height animation. There is no
`ui/collapsible.tsx` primitive — do not generate one.

Three rules that are easy to get wrong:

- **Render the label as a real button** via `SidebarGroupLabel`'s `render`
  prop (`render={<button type="button" aria-expanded … />}`), not a
  `button`-styled `div`. The label then stays keyboard reachable for free.
- **Re-hide it in icon-collapsed mode**: `SidebarGroupLabel`'s built-in styles
  hide the label in `group-data-[collapsible=icon]` with `-mt-8 opacity-0` —
  visually gone but still keyboard-focusable once it is a button. Any
  label-turned-button must add `group-data-[collapsible=icon]:hidden`
  (found by check in `09-09-topic-favorites`).
- **Peer sections stay peers.** Several sections in one group ("Favorite"
  above "Topics") are siblings with independent collapse scopes — never nest
  one inside another's collapse container, and never indent/subordinate one
  label. Share one local `SectionToggle` component between them
  (`AssistantTree.tsx` is the reference) so the two cannot drift in styling,
  and let each own its `useId` + collapse container. A nested variant with an
  indented sub-label was rejected on visual review.

---

## Testing Base UI popups in jsdom

Base UI's Select / Popover popups open on real pointer events, and jsdom has no
`PointerEvent` implementation. `fireEvent.pointerDown(trigger, …)` therefore
never opens them and an option can never be clicked. Stubbing the usual
suspects (`Element.prototype.hasPointerCapture` / `setPointerCapture` /
`scrollIntoView`) does not help — the event itself is what is missing.

What does work: `fireEvent.keyDown(trigger, { key: "ArrowDown" })` opens the
listbox, so **the option set and its labels are testable**; selecting through
the popup is not.

Consequences:

- Do test: the rendered trigger label, everything derived from props or state
  (placeholders, `required`, disabled, formatting), the option list opened via
  keyboard, and the submit payload.
- Do not try to click an option. Verify the input state by rendering the
  component with different props instead, and cover the pure derivation in a
  `src/lib/**` unit test.
- State reachable *only* by selecting belongs to browser acceptance. Record it
  as such in the task rather than writing a test that asserts nothing, and do
  not grow the shared `vitest.dom.setup.ts` for one component.

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
  failure only when both paths fail. Third-party UI that copies internally
  (Streamdown's code/mermaid/table copy buttons call the Clipboard API
  directly and cannot be given our helper) is covered by
  `lib/clipboard-polyfill.ts`, installed once from `AppProviders`: it defines
  a legacy-backed `navigator.clipboard` only when the native one is absent.
- Assuming `history.replaceState` navigates: it rewrites the URL without
  re-rendering the route, so route props (e.g. `topicId`) stay stale. State
  that depends on the effective id must derive it (`topicId ?? createdId`)
  rather than reading the route prop alone. Two further contracts when
  syncing a session-created topic into the URL this way (`ChatView`):
  - Pass `null` as the state, never `window.history.state`. Next's history
    patch treats state carrying its `__NA` marker as an internal call and
    skips the router sync, leaving `canonicalUrl` (and `usePathname`) stuck
    on the old URL; a later link to that URL then becomes a same-page
    navigation. With `null` the patch copies its internals over itself and
    adopts the new URL.
  - The router still holds the draft route tree afterwards, so navigating
    back to the draft URL (New topic, delete-then-go-draft) diffs to the
    same tree and does not remount the view. `ChatView` watches
    `usePathname` and resets to a clean draft state once the URL leaves the
    session-created topic (`urlShownForCreatedTopic`).
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
