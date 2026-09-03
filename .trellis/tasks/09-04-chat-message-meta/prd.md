# Chat page message meta info optimization

## Goal

Enrich the chat page with per-message context (who spoke, which model answered, when, and quick actions) so a conversation reads like a transcript instead of floating text blocks, and align the topic title size.

## Scope

Chat page only (`src/components/chat/`, `src/components/layout/InsetHeader.tsx`, plus the minimum backend surface needed to expose message timestamps and reasoning duration). No changes to composer, admin, or provider management.

## Requirements

### R1. Topic title font size

- The topic name in the top bar of the right panel (`InsetHeader`) renders at `1rem` (Tailwind `text-base`) instead of the current `text-lg`. Weight/tracking unchanged.

### R2. Assistant name header on AI replies

- Every assistant message shows a header row above its content (above the reasoning block if present), left-aligned.
- The row shows the assistant emoji followed by the assistant name, e.g. `✨ Assistant`.
- Name/emoji come from the assistant record (`name`, `icon`); fall back to the existing defaults (`Assistant`, `✨`) when missing.

### R3. Model name footer on AI replies

- Every assistant message shows a left-aligned line below its content with the model id that produced it (e.g. `gpt-5.2`), without the provider/config name.
- Hidden when the message has no recorded `modelId` (e.g. legacy or failed-before-start messages).

### R4. Message action row (copy only)

- Every message (user and assistant) has an action row below it that is always laid out (reserves vertical space) but invisible until the pointer hovers over that message (keyboard focus also reveals it).
- Alignment: user messages → right-aligned; assistant messages → left-aligned, directly below the model name row from R3.
- This iteration ships exactly one action: copy. It copies the message's plain text (user: raw text; assistant: raw markdown source).
- Clicking copy shows brief success feedback (check state); icon-only buttons must have an `aria-label`.

### R5. Message timestamps

- Record a creation time for both user messages and assistant messages and surface it per message:
  - User messages: a line above the bubble, right-aligned.
  - Assistant messages: on the assistant name row from R2, to the right of the name.
- Timestamps are hidden by default but reserve layout space; they fade in when the pointer hovers over that message (keyboard focus also reveals them).
- Display rules (message age, relative to now):
  - Under 1 minute: `just now`.
  - Under 1 hour: `N minutes ago`.
  - Under 24 hours: `N hours ago`.
  - 24 hours or older, current year: short date (e.g. `Sep 3`).
  - 24 hours or older, different year: date with year (e.g. `Sep 3, 2025`).
- Hovering the timestamp itself shows the exact time `yyyy-MM-dd HH:mm:ss` as a native tooltip (`title`).
- Relative labels stay fresh (re-render periodically) without noticeable jank.
- Timestamps survive page reloads (persisted server-side), and freshly sent/streamed messages show a sensible time immediately without waiting for a reload.

### R6. Thinking duration on the Thought toggle

- After the model finishes thinking, the reasoning toggle reads `Thought (X.Xs)` where `X.Xs` is the reasoning duration with 0.1s precision, wrapped in parentheses and followed by `s` (e.g. `Thought (3.2s)`).
- While thinking is still in progress (`Thinking` label), no duration is shown.
- Messages whose model produced no reasoning show no duration.
- The duration is persisted so it still shows after a reload.
- Streams aborted before thinking completed may omit the duration.

## Constraints

- Follow `.trellis/spec/frontend/` guidelines: theme tokens only, `cn()` composition, icon-only buttons need `aria-label`, keyboard reachability, `motion-reduce` safety, no `any`/`!`/unchecked `as`.
- Keep the hover-reveal via opacity (space reserved) — no layout shift on hover.
- Dark mode must render correctly (no raw colors).
- Existing behaviors must not regress: streaming placeholder, stop/fail captions, reasoning auto-open/scroll-follow, live region.
- DB schema changes require a drizzle migration (`pnpm db:generate`, `pnpm db:migrate`) and must stay backward compatible with existing rows (nullable columns only).

## Acceptance Criteria

- [ ] Topic title renders at 1rem in the right-panel header.
- [ ] Each assistant message shows `emoji + name` header, left-aligned, above reasoning/content.
- [ ] Each assistant message shows its model id (no provider) below the content, left-aligned; absent when unknown.
- [ ] Hovering a user message reveals a right-aligned copy icon below the bubble; hovering an assistant message reveals a left-aligned copy icon below the model name row; rows reserve space before hover (no shift).
- [ ] Copy writes the message text to the clipboard and shows success feedback; button has an accessible name.
- [ ] User message shows a right-aligned hover-revealed time above the bubble; assistant message shows a hover-revealed time right of the assistant name.
- [ ] Times follow the relative/date/year display rules; hovering the time shows `yyyy-MM-dd HH:mm:ss`.
- [ ] Times and model ids for history messages come from persisted data (survive reload).
- [ ] Reasoning toggle shows `Thought (X.Xs)` after thinking completes for reasoning messages, and the value survives reload.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.
