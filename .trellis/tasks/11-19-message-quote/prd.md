# Message text quote

## Goal

Let the user select text in a chat message, quote it into the composer, and
jump back to the exact source text from the quote (scroll to it and flash a
background highlight that fades back out).

## Requirements

### Selecting and quoting
- R1. Selecting non-empty text inside the **body** of a single assistant or
  user message shows a floating "Quote" button. Reasoning blocks, tool-call
  blocks, action bars, timestamps, and selections spanning multiple messages
  do not qualify.
- R2. The button sits above the selection; when that would fall outside the
  visible area of the message scroll container it sits below the selection
  instead. It stays horizontally within the container and follows the
  selection while scrolling. Pressing it must not clear the selection first.
- R3. Clicking the button adds the quote to the active draft and focuses the
  composer. A draft holds at most one quote; a new quote replaces the old one.
  The quote is per-draft, like staged attachments.

### Composer and sending
- R4. The quote renders as an atomic card above the textarea (quote icon,
  text truncated to two lines, remove button). Clicking the card body jumps
  to the source (R8).
- R5. A quote alone cannot be sent; sending still requires text or
  attachments. On send the quote is cleared with the draft.
- R6. The sent user message persists the quote (source message key, quoted
  text, start offset in the source's rendered text). The model receives the
  quoted text as context for that user turn; the user's own text stays
  unchanged.
- R7. A sent user message shows its quote card above the bubble; clicking it
  jumps to the source (R8). Editing that message (UserMessageEditor) seeds the
  quote card with a remove button; removing it drops the quote from the new
  version. Adding a quote while editing is out of scope.

### Locating the source
- R8. Jumping scrolls the message list so the quoted **text range** (not the
  message top) is centered in view, then highlights only the quoted range —
  per line fragment, partial first/last lines included — and fades it out in
  about 2s. Reduced motion skips the fade.
- R9. The range is matched by stored offset first, then by text search within
  the source message, so repeated text in one message resolves to the quoted
  occurrence.
- R10. If the text can no longer be found (version switched, message edited,
  content not matchable), fall back to the existing whole-message flash. If
  the source message no longer exists, do nothing.
- R11. Jumping must not be undone by the follow-to-bottom pin when async
  content (images, mermaid, math) grows afterwards (same rule as
  `scrollToMessage`).

## Acceptance Criteria

- [ ] Selecting text in an assistant or user message body shows the Quote
      button above it, or below when above is out of view; selecting
      reasoning / tool-call / cross-message text shows nothing.
- [ ] Quoting puts one card above the composer; quoting again replaces it;
      the card can be removed; a quote-only draft cannot be sent.
- [ ] After sending, the user message shows the quote card, the quote
      survives a reload, and the model request contains the quoted text.
- [ ] Clicking a quote card (composer or sent message) scrolls the quoted
      text into the middle of the view and highlights only the quoted lines,
      fading back out.
- [ ] Quoting the second occurrence of repeated text highlights the second
      occurrence.
- [ ] An unmatchable quote falls back to whole-message flash; a deleted source
      is a no-op.
- [ ] Editing a message with a quote shows the card; removing it and
      submitting yields a version without the quote.
- [ ] Works at mobile and desktop breakpoints; en and zh-CN copy present.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.

## Notes

- Agreed approach: quote is a card (not an inline token — a native textarea
  cannot hold atomic inline elements; a contentEditable rewrite is out of
  scope). Persist as an AI SDK custom data part (`data-quote`) and convert it
  for the model via `convertToModelMessages`' `convertDataPart`. Highlight via
  absolutely positioned overlay rects from `Range.getClientRects()` (the CSS
  Custom Highlight API cannot transition, so it cannot fade).
