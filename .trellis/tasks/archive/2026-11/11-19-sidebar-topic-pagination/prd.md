# Sidebar topic list pagination and row UX

## Goal

Keep the assistant pane's topic list fast with many topics by loading it page by page instead of all at once. Make each topic row quieter: a compact "last active" time on the right, actions shown only on hover with a mouse, and a long-press menu on touch devices.

## Background (repository evidence)

- `GET /api/assistants` → `listAssistantTree` returns **every assistant with every topic** in one LEFT JOIN, ordered `assistants.createdAt asc, topics.updatedAt desc` (`src/server/services/assistant.service.ts:94-120`). The client caches it under `assistantKeys.tree()` (`src/components/assistant/use-assistants.ts:31`).
- The only topic index is `topics_assistant_id_idx` on `assistant_id` (`src/server/db/schema/assistant.ts:47`).
- The full `assistant.topics` array is read outside the pane:
  - `AssistantTree.tsx:94` (leave the route after deleting the assistant that owns the open topic), `:435-436` (favorites / others split), `:521` (empty state);
  - `use-assistants.ts:841-886` (optimistic favorite toggle);
  - `ChatView.tsx:395-399` (header title);
  - `ChatPoolBridge.tsx:106-116` (desktop notification title and path) and `:130-139` ("already titled" check);
  - `DeleteAssistantDialog.tsx:39` (topic count in the confirmation).
- Search (`SearchDialog`, `GET /api/search`) is a server-side ILIKE across all of the user's assistants (`src/server/services/search.service.ts:34-49`) and never reads the tree cache.
- `topics.updatedAt` is written on new messages (`topic.service.ts:245`) and on rename (`topic.service.ts:73`). Favorite toggles must not touch it (`.trellis/spec/backend/topic-favorites.md`).
- Row actions today: the star shows on hover, or always when the topic is a favorite; "..." shows on hover. Both are always visible below `md:` (`src/components/ui/sidebar.tsx:578`). A spacer keeps the title clear of both buttons (`AssistantTree.tsx:634`).
- The repo has no virtual-list library, no long-press handling and no relative-time formatter. The Android shell is a Capacitor WebView that loads the remote page (`.trellis/tasks/archive/*/11-16-native-mobile/prd.md`).

## Requirements

### R1 Paginated topic list

- R1.1 The assistant pane's **Favorites** section loads all of that assistant's favorite topics in one request, not paginated.
- R1.2 The **Topics** section (non-favorites) loads 20 topics per page, newest `updatedAt` first.
- R1.3 Scrolling near the bottom of the list loads the next page automatically. A small spinner shows while it loads. No permanent "load more" button.
- R1.4 If a page fails to load, a "Retry" button appears at the end of the list. Pressing it reloads that page.
- R1.5 Pages do not skip or duplicate topics when topics change between page loads, for example a new message moves a topic to the top.
- R1.6 After send, regenerate, rename, delete, favorite or a new topic, the loaded lists refresh in the correct order. Pages that were already loaded stay loaded.
- R1.7 No virtual list. With 20-row pages, the DOM only grows as far as the user scrolls, so it is not needed now.
- R1.8 The topic loading state, the empty state ("no topics") and the error state still work.

### R2 Search unchanged

- R2.1 Search stays global and server-side, across all assistants. It finds topics that are not loaded in the sidebar. No search code changes.

### R3 Other consumers keep working without the full topic array

- R3.1 The chat header title comes from the topic itself, not from the sidebar list, so it is right for topics not loaded in the sidebar, and it updates after rename or auto-titling.
- R3.2 The desktop "reply finished" notification still shows the topic title and opens the right topic, including for topics not loaded in the sidebar.
- R3.3 Deleting the assistant you are viewing still navigates home.
- R3.4 The delete-assistant confirmation still shows the assistant's topic count.

### R4 Compact last-active time

- R4.1 Each topic row shows the topic's `updatedAt`, right-aligned and muted, after the truncated title.
- R4.2 Format (floor values):

  | Age | zh-CN | en |
  |---|---|---|
  | < 1 min | 刚刚 | now |
  | < 1 h | {n}分钟前 | {n}m |
  | < 24 h | {n}小时前 | {n}h |
  | < 7 d | {n}天前 | {n}d |
  | < 30 d | {n}周前 | {n}w |
  | < 365 d | {n}个月前 (1–11, by 30-day months) | {n}mo |
  | ≥ 365 d | year/month from the locale's date format, e.g. `2025/11` | e.g. `11/2025` |

- R4.3 The label updates by itself as time passes (at least once a minute), without a refetch.
- R4.4 While a topic is streaming, the spinner takes the place of the time.

### R5 Row actions on pointer (hover-capable) devices

- R5.1 The favorite and "..." buttons are hidden by default and appear only while the row is hovered or has keyboard focus inside it.
- R5.4 Layout: only the title and the age label share the row width (title truncates, age label keeps its natural width). The buttons are an overlay on the row's right edge. They do not take layout width, and they cover the age label and the end of the title while visible. The title does not reflow or re-truncate on hover.
- R5.2 The selected (active) topic does not keep them visible. A favorite topic does not keep the star visible either. Favorites already have their own section.
- R5.3 While a row's "..." menu is open, its buttons stay visible.

### R6 Row actions on touch devices

- R6.1 On devices without hover (`@media (hover: none)`: phones, tablets, the Android app), the favorite and "..." buttons are never visible. The time is always shown.
- R6.2 A long press (~500 ms) on a topic row opens the same menu as "..." (favorite/unfavorite, rename, delete). Lifting the finger after a long press does not open the topic.
- R6.3 A tap still opens the topic. Moving the finger (scrolling) cancels the long press.
- R6.4 The long press does not trigger the browser or WebView's own text selection, link preview or context menu on the row.
- R6.5 Desktop right-click keeps the browser default. No custom context menu.

### R7 Full title for truncated topics

- R7.1 Pointer devices: hovering (or keyboard-focusing) a topic row whose title is truncated shows a small tooltip to the right of the row with the full title, after a short delay (~500 ms). Rows whose title fits show no tooltip.
- R7.2 Touch devices: the long-press menu shows the topic's full title as a non-interactive header above the actions. The "..." menu opened by mouse or keyboard shows no header; pointer devices rely on the tooltip alone.
- R7.3 No marquee/scrolling text.

## Acceptance Criteria

- [ ] AC1 (R1.2) An assistant with 45 non-favorite topics shows 20 rows at first. Scrolling to the bottom loads 20 more, then 5. After that no more requests are sent.
- [ ] AC2 (R1.1) All favorite topics show in the Favorites section, even ones older than every loaded page.
- [ ] AC3 (R1.5) Service integration test: after one topic is touched between page 1 and page 2, the pages contain no duplicates and every untouched topic appears exactly once.
- [ ] AC4 (R1.4) A failed page shows Retry, and Retry loads it.
- [ ] AC5 (R1.6) Sending a message in a topic on page 2 moves it to the top of the Topics list without collapsing the loaded pages.
- [ ] AC6 (R1.6) Favoriting a topic moves it into Favorites right away. Unfavoriting moves it back into Topics. A failed request rolls the change back.
- [ ] AC7 (R2.1) Searching finds a topic that the sidebar has not loaded, and opening it works.
- [ ] AC8 (R3.1) Opening a topic that is not loaded in the sidebar shows the right header title. Renaming it updates the header.
- [ ] AC9 (R3.4) The delete-assistant dialog shows the real topic count with more than 20 topics.
- [ ] AC10 (R4.2) Unit tests for the formatter cover every threshold boundary in both locales.
- [ ] AC11 (R5.1/R5.2/R5.4) With a mouse, a non-hovered row (selected or favorite) shows only the title and time. On hover, the star and "..." overlay the right edge, covering the time and the end of the title, and the title's truncation point does not move.
- [ ] AC14 (R7.1) A truncated title shows the full-title tooltip on hover after the delay; a short title shows none.
- [ ] AC15 (R7.2) The long-press menu shows the full title as its header; the "..." menu opened by click shows none.
- [ ] AC12 (R6) On a touch device or emulator: no buttons are visible, a long press opens the menu without navigating, and a tap navigates. Verified on the Android app or in mobile Chrome device emulation.
- [ ] AC13 `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.

## Out of Scope

- Changing search scope or behaviour.
- Virtualized rendering.
- A desktop right-click context menu.
- Paginating the assistant list itself.
- Haptic feedback on long press.
- Pinning or highlighting the active topic when it is not in the loaded pages.

## Key Decisions

| ID | Decision | Source |
|---|---|---|
| D1 | Search stays global and full, unchanged | user |
| D2 | Favorites are loaded in full; only non-favorite topics are paginated | user |
| D3 | Auto-load on scroll, a Retry button only on failure, 20 per page | user |
| D4 | Relative units up to a year, then year/month | user |
| D5 | Touch vs pointer is decided by input capability (`hover: none`), not width; no right-click menu | user |
| D6 | No virtual list (see R1.7) | assistant |
| D7 | Full title through a tooltip shown only when truncated (pointer) + a header in the long-press menu only (touch); no marquee | user asked, assistant recommended; user removed the desktop menu header |
| D8 | Hover buttons overlay the title instead of sharing width with it | user |
