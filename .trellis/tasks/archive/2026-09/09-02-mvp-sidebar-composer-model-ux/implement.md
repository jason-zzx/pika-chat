# Implementation plan

First-batch items (0–5) are already in the working tree. Do not re-do them
unless a follow-on change regresses AC1–AC6. Continue from group 6.

## Checklist

### 0–5. Already landed (R1–R5)

Popover, theme cycle, footer structure, grouped `ModelPicker`, default-model
PATCH, in-box send/expand. Keep them green.

### 6. Message layout (R6, D7)

- [ ] `MessageItem`: user = muted right bubble; assistant = unbubbled document
      at list width; keep Streamdown, pulse caret, Stopped/failed.
- [ ] `MessageItem.test.tsx` for the two layouts and captions.

### 7. Sidebar icon-row chrome (R7, D8)

- [ ] `ThemeControl`: sidebar appearance uses `SidebarMenuButton` default
      metrics; Settings → General stays a page control.
- [ ] Username trigger: default size, not `lg`. Gear stays compact.
- [ ] Confirm New topic / Profile already match; do not restyle lists.
- [ ] Update `ThemeControl.test.tsx` / `SidebarUserMenu` coverage if selectors
      change.

### 8. Composer send-row + fill + scrollbar (R8, D6)

- [ ] Move assistant + model pickers onto the bottom inner row, left; Send/Stop
      stay right. Expand stays top-right.
- [ ] Override disabled textarea fill so in-flight matches the shell. Do not
      edit `textarea.tsx`.
- [ ] Thin themed scrollbar on the composer textarea only.
- [ ] Extend `Composer.test.tsx` (pickers share the box; Stop still replaces
      Send).

### 9. Independent title HTTP (R9, D9, D10)

- [ ] `POST /api/topics/:id/title`: parse model pair, `requireActor`, call
      `titleTopicFromFirstMessage`. Skip LLM when title is already not
      `DEFAULT_TOPIC_TITLE`. Read the first user message from DB. Return the
      topic JSON. Prompt stays server-side.
- [ ] `lib/api/topic.ts` + a Query mutation; `onSuccess` patches/invalidates
      the assistant tree. Do not abort on chat Stop or `ChatView` unmount.
- [ ] Strip `titlePromise` / `await titlePromise` from `POST /api/chat`. Keep
      `data-topic`. Do not add `data-title`.
- [ ] `ChatView`: on `data-topic`, invalidate the tree (sidebar shows
      “New topic”) and, if this send created the topic or the title is still
      the default, `POST` the title route with the current composer pair.

### 11. Viewport-locked chat + column width (R10, R12, D11, D13)

- [ ] `AppShell`: `SidebarProvider` `h-svh overflow-hidden`. Chat title
      `shrink-0`; Composer `shrink-0`; MessageList `min-h-0 flex-1 overflow-y-auto`.
- [ ] Center messages + composer at `max-w-[52.5rem]`. Assistant uses that
      width; user bubble stays the narrower chip.

### 12. Expand on the send row (R11, D12)

- [ ] Move expand/collapse left of Send/Stop. Delete the top extra row.
      Still only when overflowing or expanded. Extend `Composer.test.tsx`.

### 13. Per-topic drafts (R13, D14)

- [ ] Keyed `drafts` in `composer-store`. ChatView reads/writes the active key.
      Add a small unit test for keying. Do not persist. Reset expand on key change.

### 14. Settings sidebar pane (R14, D15)

- [ ] On `/settings/*`, sidebar shows Back + Settings + tab rows. Staff-only
      Users. Remove top `SettingsNav` from `settings/layout.tsx`. Update
      `SettingsNav` tests / AssistantTree tests. Footer stays. Gear still
      `/settings`.

### 16. Chrome follow-on (R15–R20)

- [ ] `thin-scrollbar` utility; apply to composer textarea, MessageList, and
      the assistant/topic lists.
- [ ] `SidebarContent` `overflow-hidden`; only those two lists `overflow-y-auto`.
- [ ] Home has no New topic row/title. Assistant pane still has New topic.
- [ ] Collapsed assistant header: wrap emoji under Back; name `sr-only`.
- [ ] Remove composer `border-t`.
- [ ] `InsetHeader` shares the trigger row with the title; drop ChatView’s
      second title bar; settings layout renders `InsetHeader` without a title.

### 15. Validation

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Browser, desktop + mobile drawer:
      - Previous AC1–AC15 still hold.
      - Long topic: only messages scroll; title and composer stay put.
      - Expand sits left of Send; no extra top gap on a short overflowing draft.
      - Drafts do not leak across topics.
      - Settings pane in the sidebar; top tabs gone; Back returns to assistants.
      - Message list and sidebar lists use the thin scrollbar.
      - Long assistant/topic lists scroll; header/footer stay.
      - `/` has no New topic title; assistant pane still has the button.
      - Collapsed assistant pane: emoji inside the icon column.
      - No line between messages and composer.
      - Topic title sits on the sidebar-toggle row.

## Risky files / rollback

| File | Risk | Rollback |
|---|---|---|
| `src/app/api/chat/route.ts` | Leaving `titlePromise` in would still couple Stop to titling | Delete it; titling lives on the new route |
| `title.service.ts` | LLM on every call would retitle named topics | Short-circuit when title !== DEFAULT; keep the WHERE |
| `ChatView.tsx` | Calling title on every `data-topic` wastes LLM | Only untitled / newly created topics; no Zustand title |
| `ThemeControl.tsx` | Sidebar vs Settings appearances | Page appearance stays a Button; only sidebar uses SidebarMenuButton |
| `Composer.tsx` | Pickers on the send row wrapping on mobile | `flex-wrap` left cluster; send stays right |
| `components/ui/*` | Generated | Do not hand-edit; override in domain components |

## Do not

- Add `last_used_*` columns, a title EventSource, or a `mode` on `POST /api/chat`.
- Send a synthetic titling prompt as a chat user message.
- `await titlePromise` in chat `onEnd` (the coupling being removed).
- Persist a truncated user message as the waiting title.
- Persist `pickedModel` or drafts in localStorage.
- Hand-edit `sidebar.tsx`, `textarea.tsx`, `button.tsx`, or `select.tsx`.
- Restyle assistant list or topic list rows.
- Change Settings form fields; only move the tab chrome.
