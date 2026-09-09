# Chat Scroll Behavior

> Executable contracts for the chat message list auto-scroll machinery
> (`components/chat/MessageList.tsx`). These were established in task
> `09-07-chat-scroll-behavior` after several rounds of browser-instrumented
> debugging — violating any of them reintroduces bugs that unit tests do not
> catch.

---

## The pin model

- `pinnedRef` (at-bottom) may ONLY be released by explicit user gestures:
  `onWheel` with `deltaY < 0` and upward `onTouchMove`. **Never** release it
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
while async renderers settle.
