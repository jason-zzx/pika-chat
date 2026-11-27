# Chat Scroll Behavior

> Executable contracts for the chat message list auto-scroll machinery
> (`components/chat/MessageList.tsx`). These were established in task
> `09-07-chat-scroll-behavior` after several rounds of browser-instrumented
> debugging — violating any of them reintroduces bugs that unit tests do not
> catch.

---

## The pin model

- `pinnedRef` (at-bottom) may ONLY be released by explicit user gestures:
  `onWheel` with `deltaY < 0`, upward `onTouchMove`, and a native
  `mousedown` landing in the scrollbar gutter (scrollbar drags and track
  clicks fire neither wheel nor touch events; without that hand-over the
  pin stays engaged and the next ResizeObserver growth — async code
  highlighting, mermaid, images — yanks the view back to the bottom
  mid-drag). The gutter is detected via `offsetWidth - clientWidth` with
  the press targeting the scroll container itself, and the listener must be
  a native mouse event: Chromium does not dispatch pointer events for
  scrollbar interaction. **Never** release it
  in a generic scroll handler based on distance-to-bottom: programmatic
  scrolls (send positioning, follow-output) move scrollTop away from the
  bottom and fire scroll events, so a distance-based release instantly
  cancels the pin the send effect just set and swallows all subsequent
  follow scrolling.
- `handleScroll` re-engages the pin only for **downward** scrolls that reach
  within 32px of the bottom. Upward scrolls must never re-pin: while the
  post-stream reserve drains (below), distance-to-bottom stays ~0 by design,
  so an unconditional distance check would re-pin every frame, fight the
  wheel unpin, and feed the ResizeObserver a write-read loop (visible
  jitter).

## Effects that observe refs need a real dependency

`MessageList` always mounts with `messages` still empty (history seeds after
mount; drafts start empty), so the scroll container does not exist on first
mount. Any effect that reads `containerRef` / `contentRef` (e.g. the
ResizeObserver hookup) must depend on `messages.length > 0` (or equivalent)
instead of `[]` — with `[]` it bails on first mount and never retries.

## Send reserve (pinning the sent message to the viewport top)

- The reserve is a `min-height` on the streaming **reply article** sized
  `container height − sent message height − 48px`, not a trailing spacer —
  a fixed trailing spacer lets every streamed chunk grow the total height,
  which pushes the sent message off the viewport top immediately. While the
  reply grows inside the reserve, total height is constant, so bottom-pinning
  keeps the sent message exactly at the top. Only the submitted phase (reply
  not yet in the list) uses a trailing spacer div of the same height.
- The reserve persists after the stream ends (mainstream behavior: the last
  turn keeps the space below it) and is replaced on the next send.
- After the reply completes, upward user scrolling drains the reserve by
  exactly the scrolled distance down to zero (ChatGPT/LobeHub style). The
  shrink MUST be written synchronously to the element's `style.minHeight`
  (tracked in a ref), **not** through React state — a state round-trip
  renders a frame late relative to the scroll and reads as jitter. Only when
  the reserve reaches zero is the turn state cleared in React.

## ResizeObserver follow condition

The once-created observer callback follows growth when
`pinned && (tailStreaming || sendTurnActive || !streaming)`:

- the `!streaming` disjunct keeps a bottom-pinned view glued while mermaid
  diagrams, math, and images render asynchronously after topic entry;
- a mid-list regeneration (streaming, but the tail message is not the
  streaming one) must never match — yanking the view to the bottom while the
  user watches an older message regenerate is a bug.

## Container resize (soft keyboard / composer growth)

The ResizeObserver watches the scroll **container** as well as the content
node. A soft keyboard (`interactive-widget=resizes-content`, or the Android
shell padding the decor view by the IME inset) or a growing composer shrinks
the container without changing the content size, and browsers keep
`scrollTop` (top-anchored) — so with only the content observed, nothing
re-lands a pinned view and the tail ends up under the keyboard. Any
"sometimes it does move up" observed on devices is Chromium scroll anchoring
reacting to an unrelated layout change, not this code.

On a container height change Δ (`containerHeightRef` holds the last handled
height):

- The send reserve moves by Δ first: `spacerLeftRef += Δ`, rendered value
  `max(0, spacerLeftRef)` written synchronously to the reply article and
  mirrored into `sendTurn.spacer` (covers the submitted-phase spacer and an
  article mounting later). This keeps "at the bottom" equal to "sent message
  at the viewport top"; a pinned scroll-to-bottom without it pushes a short
  reply out of view. `spacerLeftRef` stores the **unclamped** value (the send
  effect no longer floors it), so a sent message taller than the keyboard-open
  viewport gets the exact reserve back when the viewport grows.
- A view that sat at the bottom is re-landed there: the follow branch
  (`pinned && follow`) **or** a measured pre-resize distance-to-bottom
  `< BOTTOM_THRESHOLD` (`scrollHeight − prevScrollTopRef − old height`, read
  before the reserve write). The measured disjunct is required because a
  reserve drain releases the pin (upward touch) while the drain invariant
  keeps the view at the bottom — pin-only, the keyboard then covers the
  reply although the view looks (and `atBottom` reports) at the bottom. A view
  away from the bottom (reading history) is deliberately left where the
  browser keeps it — product decision, do not bottom-anchor it.
- The clamp scroll of a growing container is not a user scroll and must not
  drain the reserve. Its scroll event can arrive **before or after** the
  observer callback (both orders observed in Chromium), so both sides guard:
  the observer resyncs `prevScrollTopRef` at the end of every callback (it
  runs after the frame's scroll events, so outside resizes this only hides
  layout-driven clamps / scroll anchoring, which are not user scrolls), and
  `handleScroll` treats a scroll whose `clientHeight` differs from
  `containerHeightRef` as not moved up **and leaves `prevScrollTopRef`
  untouched**, so the observer still measures the pre-resize offset. Without
  either guard, closing the keyboard at the bottom drains the reserve in a
  clamp cascade.

## Jump/positioning operations must release the pin first

Any operation that moves the view somewhere other than the bottom (chat-map
jump, anchor navigation, "scroll to message N") must set `pinnedRef.current =
false` **before** scrolling.

The follow condition is `pinned && (tailStreaming || sendTurnActive ||
!streaming)`, and `!streaming` is true whenever the conversation is idle — so
with the pin still engaged, every asynchronous height change after the jump
(mermaid diagrams, images, math) is read by the ResizeObserver as "follow the
output" and yanks the view back to the bottom. The jump silently undoes
itself, and only in real browsers with async renderers — jsdom cannot
reproduce it.

Re-engaging the pin afterwards is the opposite operation ("back to latest"),
and landing on the last message re-pins naturally through the existing
downward-scroll rule in `handleScroll`.

## Search-result anchor (`?m=`)

Sidebar search results deep-link to `/assistant/{aid}/{tid}?m={groupId}`
(landed in `09-29-topic-message-search`; backend contract in
`../backend/search.md`). `ChatView` consumes the param once per (topic, key):
after messages seed, it jumps through the existing `scrollToMessage` (which
already releases the pin — do not add a second scroll path) and flashes the
target row for 2s via the `highlightKey`/`highlighted` prop chain, then
`router.replace`s the URL without `m`. The consumption guard must re-arm when
the param is absent: a repeat click on the same result re-adds the same `m`,
and a one-shot-per-mount guard swallows that click (found by check). A missing
target (deleted message) is a silent no-op but the param is still stripped; an empty topic (history settled, nothing seeded) also strips `m` without scrolling rather than leaving the param stuck.

## Quote jump (`scrollToQuote`, landed in `11-19-message-quote`)

`MessageListHandle.scrollToQuote(quote)` centers the quoted text range (not
the message top) and paints a fading highlight; contract in
`../backend/chat-message-quote.md`. It follows the pin-release rule above.
Two layout constraints:

- Measure the line rects **and** the content column origin before calling
  `scrollToPosition`. Under reduced motion the scroll is `"auto"` and lands
  synchronously, so an origin measured after it is off by the scroll
  distance (smooth scrolling hides this — found by check).
- The highlight rects are absolute children of the `relative` content
  column, rendered in a `Fragment` keyed by a flash id (restarts the fade).
  A wrapper element would become a flex item and add a row gap.

The floating Quote button (`QuoteSelectionButton`) is portaled and `fixed`;
it bounds itself by the scroll container's box and measures its own rendered
size in a layout effect — do not hard-code its height in the placement math.

## In-topic search-hit navigation (landed in `09-30-search-command-palette`)

The command-palette search (`SearchDialog`, mounted in `AppShell`, opened via
Ctrl/Cmd+K or the sidebar entry) stashes a one-shot hit queue in
sessionStorage (`pika:search-hit-queue`, `{ topicId, hits: groupId[]
createdAt-ASC — reversed from API order so prev/next match the visual
up/down direction, current }`, written only when the same topic has ≥2 hits)
before pushing the `?m=` deep link. `ChatView` consumes it **only in the
confirmed-jump rAF branch** of the `?m` effect — never in the
loading/empty-topic branches, which would eat the queue without a jump —
validates topic + membership (`lib/search-hit-queue.ts`, consume-once), and
drives `SearchHitNav` (`k / n`, prev/next/close) through the same
`flashMessage` path as the deep link (no second scroll path). The navigator
clears on topic switch (adjust-state-during-render), on close, and is
replaced (not stacked) by a fresh queue-less jump.

**Overlay positioning contract**: anything floating over the message area
must position against the `relative` wrapper that encloses `MessageList`
alone — not ChatView's outer container, which also holds the Composer, so
`bottom-*` offsets measured from it land inside the composer band on narrow
viewports. jsdom cannot catch this; verify in a browser.

## Effect declaration order

The topic-entry effect (scroll to bottom once when messages first appear)
must be declared **before** the send-signal effect, so its "a send is
pending" guard reads the pre-send value of `handledSendSignalRef`. Declared
after, a draft send would be misread as topic entry and scroll to the bottom,
overriding the send positioning.

## Verification

Scroll behavior is interaction- and timing-dependent; unit tests (jsdom, no
real layout) cannot cover it. Verify in a real browser with scroll-position
sampling (see the task's `implement.md` for the recipe), at minimum:
send-to-top position, stream follow, wheel-up unpin, reserve drain with zero
programmatic scrollTop write-backs, and topic entry landing at the bottom
while async renderers settle. Soft-keyboard behavior can be simulated with
`page.setViewportSize` height changes on a mobile/touch context: cycle
open/close at the bottom (idle, after a short reply, after a long reply) and
while scrolled up, sampling distance-to-bottom, the sent message's top offset
and the reply article's `min-height`.
