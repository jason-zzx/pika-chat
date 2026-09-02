# MVP leftover sidebar, composer, and model UX

## Goal

Signed-in users can switch theme and open settings without opening the account menu, send and expand the composer the way ChatGPT does, start a new topic already on the model they last chose for that assistant, and find a model by provider or name. Follow-on in the same task: user bubbles vs document-style assistant messages, unified sidebar icon rows, composer chrome on the send row, a topic row that appears on send while the title stays “New topic” until the title model returns, a viewport-locked chat column, per-topic drafts, and settings as a sidebar sub-pane.

## Background

**F1 — Sidebar footer is a theme row plus username+gear.** `AppSidebar.tsx` renders `ThemeControl` above `SidebarUserMenu`. Theme is a `Button size="sm"` (`ThemeControl.tsx:59-66`). Username is `SidebarMenuButton size="lg"` (`h-12`, `SidebarUserMenu.tsx:41-45`). Gear is a compact `size-8` link to `/settings`. The username menu is identity + Sign out only. `ThemeMode` is `"light" | "dark" | "system"`; click cycles via `nextThemeMode` (`src/lib/theme.ts`) and `persistTheme`. Settings → General reuses `ThemeControl`.

**F2 — Composer send is inside the box; pickers are not.** `Composer.tsx:109-179`: assistant and model pickers sit on a row above a `rounded-2xl bg-muted/40` container. Send/Stop are circular controls on a bottom inner row (`justify-end`). Empty drafts occupy two rows (`min-h-[3rem]`); collapsed cap is six rows (`max-h-[9rem]`); expand sits top-right. Disabled textarea uses generated `disabled:bg-input/50` / `dark:disabled:bg-input/80` (`textarea.tsx:10`) over the muted shell, so in-flight paints two backgrounds. Overflow is native `overflow-y-auto`; `globals.css` has no scrollbar tokens. `no-scrollbar` exists only on sidebar content (`sidebar.tsx:374`).

**F3 — New-topic model seed and picker write-back already exist.** `ChatView` seeds through `resolveComposerModel`: last assistant message on the topic → assistant `defaultProviderConfigId`/`defaultModelId` → `null`, dropping stale pairs. A user pick calls `useSetAssistantDefaultModel` (`PATCH /api/assistants/:id`) with optimistic tree `setQueryData`. Seed, null, unchanged, and in-flight picks do not PATCH. `pickedModel` remains a single Zustand value (`composer-store.ts`), not persisted.

**F4 — One grouped searchable `ModelPicker` is shared.** `model-pick.ts` encodes, groups by `configId`, and filters `configName` + `modelId`. Composer and `AssistantEditorDialog` both render it; the editor passes `allowClear`. Primitive is generated `popover.tsx`.

**F5 — Both roles share a bubble.** `MessageItem.tsx:22-28`: user `bg-primary text-primary-foreground`, assistant `bg-muted text-foreground`, both `rounded-lg px-3 py-2` and `max-w-[min(100%,42rem)]`. Assistant markdown is Streamdown inside that box. Stopped/failed captions sit under the article (`MessageItem.tsx:46-54`). `MessageList` is a column of items with no extra width rule (`MessageList.tsx:24-30`).

**F6 — Footer and assistant-pane action rows do not share one control.** Canonical chrome is `sidebarMenuButtonVariants` default: `h-8`, `p-2`, `gap-2`, `[&_svg]:size-4`, `hover:bg-sidebar-accent` (`sidebar.tsx:477-496`). New topic and Profile already use default `SidebarMenuButton` (`AssistantTree.tsx:256-266`). Theme (`Button`) and username (`size="lg"`) diverge. Assistant list and topic list are out of this pass.

**F7 — Topic row and user message persist before the stream; the title and sidebar wait.** `POST /api/chat` creates the topic (`route.ts:78-84`), appends the user message (`:89-93`), and starts `titleTopicFromFirstMessage` in parallel (`:102-110`). The title UPDATE runs when that call finishes, but `onEnd` **awaits** `titlePromise` (`:213`) before the stream is considered done. The client only invalidates the assistant tree in `useChat.onFinish` (`ChatView.tsx:144-146`). `data-topic` carries `{ topicId, streamId }` and no title (`chat.ts:20-22`). Chat-streaming D6/D7 already required title generation not to block the first token and the title to travel on the stream (`archive/2026-09/08-31-chat-streaming/prd.md:248-270`). `titleTopicFromFirstMessage` still writes only while `title === DEFAULT_TOPIC_TITLE` (`title.service.ts:70-72`); generation failure falls back to `fallbackTitleFromMessage`. `DEFAULT_TOPIC_TITLE` is `"New topic"` (`lib/schemas/topic.ts:3`). Title generation uses a 15s abort (`title.service.ts:53`).

**F12 — The chat shell can grow past the viewport.** `SidebarProvider` wrapper is `min-h-svh` (`sidebar.tsx:141`). `AppShell` sets `SidebarInset` to `overflow-hidden` (`AppShell.tsx:31-36`) but does not lock `h-svh`. `MessageList` is `flex-1 overflow-y-auto` (`MessageList.tsx:24`). When the column is taller than the viewport, the window scrolls and the title bar plus composer leave the screen.

**F13 — Expand occupies its own row above the textarea.** `Composer.tsx:110-126` renders the toggle in a top `flex justify-end` strip whenever `showExpandToggle` is true, so a short overflowing draft gets a full extra row of chrome.

**F14 — The message column is the full inset width.** `MessageList` only adds `px-4`. Assistant messages are `w-full` (`MessageItem.tsx:27`). User bubbles cap at `42rem`.

**F15 — Draft text is one global Zustand string.** `composer-store.ts:9-19` has a single `draft`. `ChatView` reads/writes that value for every topic and the assistant draft (`ChatView.tsx:104-105`).

**F16 — Settings tabs live in the main pane.** `settings/layout.tsx` renders `SettingsNav` above `PageContainer` children. `SettingsNav.tsx:29` is a horizontal tab row. Gear links to `/settings`. On `/settings/*`, `AssistantTree` still shows the assistant list because `parseAssistantPath` ignores that route.

## Decisions

**D1 — Theme is a cycle control, reused in Settings → General.** Click order: `light → dark → system → light`. Icon + label (sun / moon / monitor). Same cookie and `persistTheme` path as today.

**D2 — Username menu keeps identity and Sign out.** Settings and Theme stay out of the menu. Gear (icon-only, `aria-label`) is a sibling of the name and goes to `/settings`, closing the mobile drawer. Collapsed icon-mode still exposes theme, settings, and the account menu as icon-sized controls with tooltips.

**D3 — Composer chrome is ChatGPT-shaped.** Send/Stop live inside the rounded input container (circular, bottom-right). Empty drafts occupy two rows; content grows to a **6-row** collapsed cap, then scrolls. Exceeding 6 rows shows expand; expanded cap is **about half the chat pane, min 12 rows**. Collapse restores the 6-row cap. Clearing the draft (send) exits expanded state. Enter sends; Shift+Enter inserts a newline. Picker placement is D6. Expand placement is D12.

**D4 — Picking a model writes that pair as the assistant's default immediately.** Not on send. `ChatView` PATCHes `{ defaultProviderConfigId, defaultModelId }` when the user selects a model for a resolved assistant. No-op if the pair already matches. Failure reverts the composer pick and shows an error. Composer has no “clear default”. The editor can still save “No default model”. Seeding stays: existing topic last assistant message → assistant default → none. Optimistic tree-cache update on mutate.

**D5 — One searchable grouped picker, used by composer and editor.** Group by provider config (`configId`; header is `configName`). Search matches `configName` and `modelId` case-insensitively; a config-name hit shows every model in that config. Editor passes `allowClear`. Do not hand-edit generated `components/ui/` beyond the already-added popover.

**D6 — Pickers live on the send row, left; send/stop stay right.** Same inner chrome as D3. While `inFlight`, textarea background matches the composer container (override the disabled input fill in `Composer`; do not edit `textarea.tsx`). Composer textarea overflow uses a thin themed scrollbar, not the browser default. Message-list scroll ownership is D11.

**D7 — User messages keep a bubble; assistant messages do not.** User: right-aligned, using the former assistant bubble tokens (`bg-muted text-foreground`, rounded padding). Assistant: document layout — no fill, no rounded chip, full column width of the list, Streamdown unchanged. Stopped/failed captions stay under the assistant message.

**D8 — Sidebar icon+label rows share `SidebarMenuButton` default metrics.** Apply to theme cycle (sidebar instance), username trigger, New topic, and Profile: same height (`h-8`), padding, `gap-2`, `[&_svg]:size-4`, and `hover:bg-sidebar-accent`. Gear stays a compact icon-only control. Do not restyle assistant list or topic list. Settings → General may keep a non-sidebar appearance for `ThemeControl`; D8 is the sidebar rows.

**D9 — Chat and title are two HTTP requests, and they do not share `POST /api/chat`.** Reusing the chat route for a “preset title prompt” would persist that prompt as a user turn, stream a fake assistant reply into `useChat`, and force a mode branch inside the streaming handler. Rejected. `POST /api/chat` stops generating titles (remove `titlePromise` / `await` in `onEnd`). After `data-topic`, the client calls a new Route Handler `POST /api/topics/:id/title` with the current composer model pair. The server loads the first user message from the database, runs `generateText` with a server-owned titling prompt, and UPDATEs only while `title === DEFAULT_TOPIC_TITLE`. The title response is JSON, not a stream. Chat `inFlight` / Stop follow only the chat request. Titling never fails the chat turn. Manual rename still wins.

**D10 — Interim title is `DEFAULT_TOPIC_TITLE` (“New topic”).** Do not persist or display a truncated user message while waiting. Generation failure still falls back to `fallbackTitleFromMessage` (existing `title.service.ts` behavior); that is a post-wait write, not an interim placeholder. If the topic is already named, the title endpoint returns it and does not call the model.

**D11 — Only the message list scrolls.** The app shell, chat title bar, and composer stay in place. The shell is a viewport-tall column (`h-svh overflow-hidden` on `SidebarProvider` from `AppShell`, not a hand-edit of `sidebar.tsx`). `MessageList` is `min-h-0 flex-1 overflow-y-auto`. Composer is `shrink-0`.

**D12 — Expand/collapse sits immediately left of Send/Stop.** It must not take its own row above the textarea. Still shown only when the draft overflows the collapsed cap, or is already expanded.

**D13 — Chat messages and composer share a centered 52.5rem (840px) column**, capped at the pane width. User bubbles stay a narrower chip inside that column. Assistant document uses the column width. The topic title bar may span the inset.

**D14 — Draft text is per conversation, in memory.** Zustand keys: `topic:${topicId}` or `draft:${assistantId}`. Switching topics restores that key. Send clears the active key. Do not persist drafts to `localStorage`. `pickedModel` stays a single global pick.

**D15 — Settings is a sidebar sub-pane, like an assistant.** `/settings/*` replaces the assistant list with Back + “Settings” and General / Account / Providers / Users (`SidebarMenuButton` rows). Users stays staff-only. Remove the horizontal `SettingsNav` from the settings page header. Routes stay `/settings/general` etc. Gear still goes to `/settings`. Theme + username footer stay visible.

**D16 — Message-list overflow uses the same thin themed scrollbar as the composer.** Shared `thin-scrollbar` utility; do not restyle the document scrollbar.

**D17 — Sidebar chrome stays put; only the assistant list and the topic list scroll.** Header (back / name / Settings title) and footer (theme + username) stay on screen. New topic, Profile, Assistants/Topics labels, and New assistant stay outside those scroll regions. Pass `overflow-hidden` into `SidebarContent`; do not hand-edit `sidebar.tsx`. Settings tab rows are short and do not need their own scroller.

**D18 — Home (`/`) does not show a New topic control or title.** The assistant-list sidebar has no New topic row. The inset header on `/` is the sidebar trigger only until a topic id exists (first send). Assistant draft and topic routes still show the title.

**D19 — Collapsed icon-mode assistant header must stay inside the icon column.** Back and emoji stack (emoji wraps to the next line). The assistant/settings name is `sr-only` in icon mode so it cannot overflow.

**D20 — No divider between the message list and the composer.** Drop the composer `border-t`. The inset header may keep its bottom border.

**D21 — The conversation title shares the inset header row with `SidebarTrigger`.** `InsetHeader` is that row. ChatView no longer has a second title bar. Settings uses `InsetHeader` without a title so the trigger stays.

## Requirements

**R1 — Sidebar footer.** Theme row above username+gear row, per D1–D2, with D8 chrome on those rows.

**R2 — Composer send/stop inside the input**, per D3.

**R3 — Composer auto-grow with expand/collapse**, per D3.

**R4 — Assistant default follows the picker**, per D4. New topics for assistant A open on A's stored default. Switching the home assistant picker reseeds from that assistant's default. A stale stored pair (no longer in `GET /api/models`) shows the empty placeholder.

**R5 — Grouped searchable model picker**, per D5.

**R6 — Message layout**, per D7.

**R7 — Sidebar icon-row chrome**, per D8.

**R8 — Composer send-row pickers, loading fill, themed scrollbar**, per D6.

**R9 — First-send topic visibility and independent title**, per D9–D10.

**R10 — Viewport-locked chat column**, per D11.

**R11 — Expand control on the send row**, per D12.

**R12 — Readable chat column width**, per D13.

**R13 — Per-topic composer drafts**, per D14.

**R14 — Settings sidebar sub-pane**, per D15.

**R15 — Themed message-list scrollbar**, per D16.

**R16 — Sidebar list scroll ownership**, per D17.

**R17 — Home has no New topic chrome**, per D18.

**R18 — Collapsed assistant header stays in bounds**, per D19.

**R19 — No composer/list split line**, per D20.

**R20 — Title on the sidebar-trigger row**, per D21.

## Out of scope

- Provider brand logos (this product has named OpenAI-compatible configs, not a vendor catalog).
- New database columns, a last-used endpoint, a title EventSource, or a `mode` flag on `POST /api/chat`.
- Sending a synthetic “please title this” user message through the chat stream.
- Regenerating a turn, or changing how a sent turn records its model.
- Restyling assistant-list or topic-list *rows* (scroll ownership of those lists is in scope).
- Redesigning Settings *forms* (General / Account / Providers / Users content stays).
- Hand-editing existing generated `components/ui/` files except the already-added `popover.tsx`.
- Persisting `pickedModel` or drafts in localStorage.

## Acceptance criteria

- [ ] **AC1** Sidebar footer shows a theme row above a username+gear row. Gear goes to `/settings`. Theme click cycles light → dark → system and updates the icon, `html.dark`, and the theme cookie. Username menu still signs out and no longer contains Settings or the three-button theme radiogroup. Collapsed icon-mode keeps the three controls reachable.
- [ ] **AC2** Send is a circular up-arrow inside the composer box; Stop replaces it in-flight. Keyboard send/newline behavior is unchanged.
- [ ] **AC3** Composer starts at two rows, caps at six, shows expand only when content exceeds six rows, expands to the larger cap, and collapse (or sending) restores the six-row cap.
- [ ] **AC4** Selecting model M for assistant A PATCHes A's default to M without sending. A new topic for A opens with M selected. An existing topic still opens on that topic's last assistant model when present. A failed PATCH leaves the previous pick selected and shows an error.
- [ ] **AC5** Model picker groups by provider config, filters by provider name and model id, and is used from both the composer and the assistant editor (editor still offers “No default model”).
- [ ] **AC6** Icon-only controls have `aria-label`s; desktop and mobile (drawer) footer layouts remain usable; `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
- [ ] **AC7** User messages render as muted bubbles, right-aligned. Assistant messages render as unbubbled document markdown across the list width. Stopped/failed still appear under assistant turns.
- [ ] **AC8** Theme, username, New topic, and Profile rows match each other in height, padding, icon size, icon-to-label gap, and hover. Assistant list and topic list rows are unchanged. Gear stays compact.
- [ ] **AC9** Assistant and model pickers sit on the composer’s bottom inner row, left of Send/Stop. During in-flight, the textarea fill matches the composer shell. Composer overflow uses a themed scrollbar.
- [ ] **AC10** Sending the first message of a new topic persists the topic and user message and shows the topic in the sidebar as “New topic” without waiting for the assistant reply or the title request. `POST /api/chat` does not generate titles. After `data-topic`, a separate `POST /api/topics/:id/title` generates the title; Stop / `inFlight` clear when the chat stream ends, even if titling is still running. When that request returns (model title or truncation fallback), the sidebar updates. A slow or failed title call does not drop the topic row or fail the turn. A manual rename during generation is not overwritten. Already-named topics do not spend an LLM call.
- [ ] **AC11** Scrolling a long topic moves only the messages. The shell header, topic title, and composer stay on screen.
- [ ] **AC12** Expand/collapse is left of Send/Stop on the same row. It does not add a row above the textarea. Short drafts (no overflow) have no expand control and no extra top gap.
- [ ] **AC13** Messages and composer sit in a centered column of 52.5rem (840px), or the pane width if narrower. Assistant markdown uses that column; user bubbles stay a narrower chip.
- [ ] **AC14** Text typed in topic A’s composer is still there after visiting topic B and returning. Topic B does not show A’s draft. An assistant’s New topic draft is separate from that assistant’s existing topics. Send still clears the active draft.
- [ ] **AC15** Opening Settings replaces the assistant list with a Settings pane (Back, then General / Account / Providers / Users). Users is hidden for non-staff. The settings page no longer has a top tab bar. Back returns to the assistant list. Theme and username footer remain.
- [ ] **AC16** A long conversation’s message list uses the same thin themed scrollbar as the composer textarea.
- [ ] **AC17** A long assistant list or topic list scrolls inside that list. The sidebar header, New topic/Profile (assistant pane), New assistant, and the theme/username footer stay on screen.
- [ ] **AC18** `/` has no New topic button and no “New topic” inset title. Opening an assistant still has New topic in that pane.
- [ ] **AC19** Collapsing the sidebar on an assistant pane keeps the emoji inside the icon column (wrapped under Back). The name does not stick out of the sidebar.
- [ ] **AC20** There is no horizontal rule between the message list and the composer.
- [ ] **AC21** On a topic or assistant draft, the conversation title is on the same row as the sidebar toggle. Settings still has that toggle and no second title bar.
