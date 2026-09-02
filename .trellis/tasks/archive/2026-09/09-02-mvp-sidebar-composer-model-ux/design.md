# Sidebar / composer / model UX — Technical Design

Companion to `prd.md`. Requirement IDs (R1–R9) and decision IDs (D1–D10) refer
to that document.

First-batch work (R1–R5) is already in the working tree. This document keeps
those contracts and adds the follow-on (R6–R9).

## Change boundary

| Live today | Should happen |
|---|---|
| Theme cycle + gear exist, but Theme is `Button` and username is `size="lg"` | Those rows plus New topic / Profile share default `SidebarMenuButton` chrome (D8) |
| User `bg-primary` bubble; assistant `bg-muted` bubble | User muted bubble; assistant document, no chip (D7) |
| Pickers on a row above the composer box | Pickers on the send row, left (D6) |
| Disabled textarea fill ≠ composer shell | Override disabled fill in `Composer` only (D6) |
| Native composer scrollbar | Thin themed scrollbar on the textarea (D6) |
| `onEnd` awaits `titlePromise`; tree invalidates in `onFinish` | Chat route does not title. Client `POST /api/topics/:id/title` after `data-topic`; tree updates from that JSON (D9, D10) |
| Window scrolls the whole chat column | Only `MessageList` scrolls; title + composer stay put (D11) |
| Expand toggle is a top row in the composer | Expand sits left of Send/Stop (D12) |
| Messages span the full inset | Centered 52.5rem column for list + composer (D13) |
| One global `draft` string | Keyed drafts: `topic:` / `draft:` (D14) |
| Settings tabs in the main pane | Settings sub-pane in the sidebar (D15) |
| Native message-list scrollbar | Same thin themed scrollbar as composer (D16) |
| Whole `SidebarContent` scrolls | Only assistant list + topic list scroll (D17) |
| Home inset title is “New topic” | No New topic chrome on `/` (D18) |
| Collapsed assistant header overflows | Back + emoji wrap; name `sr-only` (D19) |
| Composer `border-t` | No list/composer divider (D20) |
| Chat title in a second bar under the trigger | Title on the `SidebarTrigger` row (D21) |

Not in this change: new columns, Server Actions, regenerating a turn,
restyling assistant/topic list *rows*, overloading `POST /api/chat` with a
title mode.

`components/ui/` stays generated territory. Do not hand-edit `textarea.tsx`,
`button.tsx`, or `sidebar.tsx`. Wrap domain components around them.

## File map (follow-on)

```
src/
├── lib/schemas/topic.ts                # MODIFIED — generate-title request schema if needed
├── lib/api/topic.ts                    # MODIFIED — generateTopicTitle()
├── app/api/chat/route.ts               # MODIFIED — remove titlePromise / await
├── app/api/topics/[id]/title/route.ts  # NEW — POST generate title
├── server/services/title.service.ts    # MODIFIED — skip LLM if already named; return Topic
├── components/chat/
│   ├── MessageItem.tsx                 # MODIFIED — bubble vs document
│   ├── Composer.tsx                    # MODIFIED — send-row pickers, fill, scrollbar
│   └── ChatView.tsx                    # MODIFIED — data-topic invalidate; POST title
├── components/layout/
│   ├── ThemeControl.tsx                # MODIFIED — sidebar variant = SidebarMenuButton
│   └── SidebarUserMenu.tsx             # MODIFIED — username default size, not lg
└── tests:
    MessageItem.test.tsx                # NEW
    Composer.test.tsx                   # extend: in-flight fill / pickers in box
    ThemeControl.test.tsx               # still cycle; wrap SidebarProvider
    title.service.test.ts               # skip-when-named / return value
```

AssistantTree New topic / Profile already use default `SidebarMenuButton`;
touch only if a class override still diverges.

## Data flow — title (D9, D10, R9)

Rejected: a second `POST /api/chat` whose user text is a titling prompt.
That handler always `appendUserMessage` + streams + `appendAssistantMessage`,
so a “preset prompt” becomes a real turn unless the route grows a mode flag.
That is two products in one streaming handler; this task adds
`POST /api/topics/:id/title` instead.

```
POST /api/chat (persist + stream only; no title LLM)
  → createTopicForChat (title = DEFAULT_TOPIC_TITLE) if needed
  → appendUserMessage
  → writer.write(data-topic { topicId, streamId })
  → merge token stream
  → onEnd: appendAssistantMessage; do not title

Client (parallel, after data-topic, only if untitled / this send created the topic)
  → POST /api/topics/:id/title { providerConfigId, modelId }
      → if topic.title !== DEFAULT_TOPIC_TITLE: return topic (no LLM)
      → first user message text from DB (not from the client body)
      → generateText with server-owned prompt
      → UPDATE WHERE title = DEFAULT_TOPIC_TITLE
      → return topic (generated, fallback, or the user's rename if 0 rows)
  → setQueryData / invalidate assistantKeys.tree()
```

Titling prompt stays in `title.service.ts` (short title, title only, no quotes,
≤8 words). The client does not send prompt text.

The title fetch must not share the chat abort signal. Stopping the reply, or
unmounting `ChatView`, must not cancel titling. `useChat` transport stays chat
only.

`ChatDataParts` stays `{ topic: { topicId, streamId } }`. No `data-title`.
The title HTTP response is the completion signal; no delayed tree refetch.

## Composer layout (D3 + D6 + D12)

```
┌──────────────────────────────────────────┐
│  textarea                                │
│  [Assistant?] [Model]    [expand] (↑ / ■)│
└──────────────────────────────────────────┘
```

- Bottom inner row: `justify-between`. Left cluster is pickers; right cluster is
  expand (if shown) then Send/Stop.
- Expand does not render a row above the textarea.
- In-flight: textarea `disabled:bg-transparent dark:disabled:bg-transparent`.
- Scrollbar: Composer-local thin thumb. Do not edit `textarea.tsx`.

## Chat column (D11, D13)

`AppShell` passes `h-svh overflow-hidden` to `SidebarProvider` (className). Do
not hand-edit `sidebar.tsx`. Keep `SidebarInset` + inner column `min-h-0
overflow-hidden`. `InsetHeader` (`SidebarTrigger` + optional title) is
`shrink-0` and is the only chat title bar. Composer `shrink-0` with no
`border-t`. MessageList `min-h-0 flex-1 overflow-y-auto thin-scrollbar`.
Home (`/`) passes no title until a topic id exists.

Messages and composer share `mx-auto w-full max-w-[52.5rem]`. Assistant
`w-full` of that column. User bubble keeps a narrower cap (`max-w-[min(100%,42rem)]`).

## Drafts (D14)

`composer-store` replaces `draft: string` with `drafts: Record<string, string>`
and `setDraft(key, value)`. ChatView key is `topic:${topicId}` or
`draft:${resolvedAssistantId ?? "none"}`. Select only the active key. Send
writes `""` to that key. No localStorage. Reset Composer `expanded` when the
key changes.

## Settings pane (D15)

When `pathname` starts with `/settings`, `AssistantTree` (or a sibling pane
owned by `AppSidebar`) renders:

```
Header: [Back] Settings
Nav: General, Account, Providers, [Users if staff]
```

Reuse the tab list from `SettingsNav`. Rows are `SidebarMenuButton` +
`CloseOnNavigateLink`. `settings/layout.tsx` stops rendering the top tab bar.
`PageContainer` still wraps the form. Footer unchanged. Back is `router.push("/")`
like the assistant pane.

## Message layout (D7)

User article stays `items-end`. Inner chip: `bg-muted text-foreground
rounded-lg px-3 py-2` and keep a readable max width.

Assistant article: `items-start`, no background, no rounded chip, width of the
list column (`w-full`), Streamdown unchanged. Empty streaming assistant still
shows the pulse caret. Stopped/failed captions stay below.

## Sidebar icon rows (D8)

Canonical metrics come from `sidebarMenuButtonVariants` default (`h-8`, `p-2`,
`gap-2`, `[&_svg]:size-4`).

- `ThemeControl`: optional appearance. Sidebar footer uses `SidebarMenuButton`
  (not `Button size="sm"`). Settings → General keeps a page control so the
  settings form does not look like a sidebar row.
- Username trigger: drop `size="lg"`.
- Gear: keep `size-8`.
- New topic / Profile: already default; do not restyle lists.

## Compatibility / rollback

- No migration. Rolling back the UI leaves stored `default_*` and topic titles
  which existing seed/rename already understand.
- Removing titling from `POST /api/chat` is the rollback-sensitive change: if
  the client never calls the new route, topics stay “New topic” until a manual
  rename. Keep the UPDATE guard so a late title response cannot clobber a
  rename.

## Trade-offs

| Choice | Why |
|---|---|
| “New topic” until the model returns (D10) | User-specified; existing UPDATE guard keeps working; no interim flicker |
| New `POST /api/topics/:id/title`, not a second `/api/chat` | Chat persist/stream must not grow a mode flag or ingest a fake user turn |
| Title JSON, not SSE | Short completion; completion signal is the HTTP response |
| Override disabled fill in Composer | Generated `textarea.tsx` is off-limits |
| SidebarMenuButton wrap, not editing `sidebar.tsx` | Same reason |
| Viewport-locked shell (`h-svh`) | `min-h-svh` lets the column grow and the window steal scroll |
| 52.5rem / 840px column | Between ChatGPT (768) and LobeChat (924); still readable |
| In-memory keyed drafts | Matches “don’t persist pickedModel”; refresh loses unsent text |
| Settings as a sidebar pane | Same pattern as AssistantPane; no extra route tree |
