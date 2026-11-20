# Design: sidebar topic pagination and row UX

## 1. Boundaries

| Layer | Change |
|---|---|
| DB | Composite index for the paged and favorites reads. Drizzle-generated migration. |
| Service | `assistant.service`: the tree drops topics and gains `topicCount`. `topic.service`: two new reads. `findTopicDetailForActor` projects `assistantId`. |
| Routes | `GET /api/assistants/[id]/topics` (paged) and `GET /api/assistants/[id]/topics/favorites`. |
| Schemas | `assistantSchema` replaces `topics` with `topicCount`. New `topicPageSchema`. `topicDetailSchema` gains `assistantId`. |
| Client data | Infinite query for non-favorites, a plain query for favorites, optimistic favorite move, consumers moved off `assistant.topics`. |
| UI | `AssistantTree.tsx` pane/row: sentinel auto-load, retry, age label, hover/touch actions, long press. |
| i18n | `Layout.tree.age.*`, `Layout.tree.loadMoreFailed`, `Layout.tree.retry` in `messages/en.json` and `messages/zh-CN.json`. |

Search (`search.service`, `SearchDialog`) is untouched (PRD D1).

## 2. Data contracts

### 2.1 Tree

```ts
assistantSchema = z.object({
  id, name, icon, systemPrompt, defaultProviderConfigId, defaultModelId,
  topicCount: z.number().int(),
});
```

`selectTree` becomes `assistants LEFT JOIN topics GROUP BY assistants.id` with `count(topics.id)::int`, ordered by `assistants.createdAt asc`. `loadAssistant` (used by create/update) uses the same query, so `Assistant` keeps one shape everywhere.

### 2.2 Paged topics (non-favorites)

`GET /api/assistants/[id]/topics?cursor=<opaque>` → `{ topics: Topic[], nextCursor: string | null }`

- Ownership: `requireOwnedAssistant` → 404 for a missing or foreign assistant (error-handling spec).
- Filter `assistant_id = :id AND is_favorite = false`, order `updated_at desc, id desc`, `limit 21`. The 21st row only signals that there is a next page and is not returned. The page size `TOPIC_PAGE_SIZE = 20` is a server constant; the client never sends a limit.
- **Keyset cursor, not offset** (R1.5). The cursor is the last returned row's `(updated_at, id)`. `updated_at` must be carried at **microsecond precision**: `defaultNow()` writes µs, and JS `Date` would truncate to ms, so `(updated_at, id) < (cursorAt, cursorId)` could skip rows that share a millisecond. Select `updated_at::text` next to the row and put that string in the cursor. Compare with `sql\`(${topics.updatedAt}, ${topics.id}) < (${at}::timestamptz, ${id})\``.
- Encoding: `base64url(JSON.stringify([atText, id]))`. The route decodes it and validates it once with Zod (`z.tuple([z.string(), z.string()])`). A malformed cursor → 400 through `withErrorHandling`.
- A topic touched between page loads moves to the top. It drops out of later pages (its new `updated_at` is above the cursor) and shows up on page 1 when the query refetches. No duplicates, and untouched rows are never skipped.

### 2.3 Favorites

`GET /api/assistants/[id]/topics/favorites` → `{ topics: Topic[] }`: every favorite of that assistant, `updated_at desc, id desc`, not paginated (D2).

### 2.4 Index

Replace `topics_assistant_id_idx` with `topics_assistant_list_idx` on `(assistant_id, is_favorite, updated_at desc, id desc)`. Its `assistant_id` prefix still serves the FK/cascade and `topicIdsForAssistant` lookups. The migration is routine and not mentioned in the changelog.

### 2.5 Topic detail

`topicDetailSchema` and `findTopicDetailForActor` gain `assistantId: z.string()`. Only the detail read changes; `topicColumns` / `Topic` stay as they are, so the six Topic projections in the favorites spec are unaffected.

## 3. Client data layer (`use-assistants.ts`)

```ts
assistantKeys = {
  all: ["assistants"],
  tree: () => [...all, "tree"],
  topics: (assistantId) => [...all, "topics", assistantId],
  topicPages: (assistantId) => [...topics(assistantId), "pages"],
  favoriteTopics: (assistantId) => [...topics(assistantId), "favorites"],
};
```

- `useTopicPages(assistantId)` → `useInfiniteQuery({ initialPageParam: null, getNextPageParam: (last) => last.nextCursor })`. On invalidation, TanStack Query v5 refetches every loaded page in order and recomputes each cursor from the fresh data, so loaded pages stay loaded and stay consistent (R1.6).
- `useFavoriteTopics(assistantId)` → `useQuery`.
- Every key stays under `assistantKeys.all`, so the existing `invalidateQueries({ queryKey: assistantKeys.all })` after rename/delete/create keeps working. The `assistantKeys.tree()` invalidations that exist only to refresh topic order or titles (`ChatPoolBridge.tsx:71,127,145`, `ChatView.tsx:1164`) switch to `assistantKeys.all`. Only active queries refetch; inactive ones are just marked stale.
- `useSetTopicFavorite` variables gain `assistantId`. `onMutate` cancels both queries, snapshots both, and moves the topic:
  - favorite on: remove it from the pages and insert it into favorites in `updatedAt desc` order;
  - favorite off: remove it from favorites and insert it into the page whose range contains its `updatedAt`. If it is older than everything loaded and `hasNextPage`, drop it; a later page will return it.

  `onError` restores both snapshots, but only while the moved topic still shows the optimistic `isFavorite` (keeps the existing "newer mutation wins" guard). `onSettled` invalidates `assistantKeys.topics(assistantId)`.
- `useRenameTopic` also invalidates `topicKeys.all` so the header title refreshes (R3.1).

### Consumers moved off `assistant.topics`

| Site | New source |
|---|---|
| `AssistantTree.tsx:94` leave after deleting an assistant | `pathAssistantId === assistant.id` |
| `ChatView.tsx:395` header title | `topicDetail.data?.title ?? topicTitle ?? tChat("newTopic")` (`useTopicDetail` already exists at `ChatView.tsx:251`) |
| `ChatPoolBridge.tsx:106` notification | `queryClient.fetchQuery({ queryKey: topicKeys.detail(userId, topicId), queryFn: () => getTopic(topicId) })` → `title` + `assistantId`. A failed fetch shows no notification, the same as "not in tree" today. |
| `ChatPoolBridge.tsx:130` "already titled" | `getQueryData(topicKeys.detail(userId, topicId))`. After `waitForTopicTitle` resolves, `setQueryData` the detail it returns, then invalidate `assistantKeys.all`. |
| `DeleteAssistantDialog.tsx:39` | `assistant.topicCount` |

## 4. UI (`AssistantTree.tsx`)

### 4.1 Pane

- The favorites section renders from `useFavoriteTopics`. It is still hidden when empty.
- The topics section renders `pages.flatMap(p => p.topics)`. Skeleton rows while the first page is pending; the empty state when there are no favorites and no non-favorites. A first-page error shows the existing load-failed empty state.
- **Sentinel**: a `<div>` after the topics list, observed by an `IntersectionObserver` whose `root` is the pane's scroll container (`SidebarGroupContent`), `rootMargin: "0px 0px 200px 0px"`. When it intersects and `hasNextPage && !isFetchingNextPage && !isFetchNextPageError` and the topics section is open, it calls `fetchNextPage()`. The effect depends on the number of loaded pages, so the observer is recreated after each page. The initial callback of a fresh `observe()` then loads again while the sentinel is still on screen. Without that, a first page shorter than the viewport would stop loading.
- After the list: a small `Loader2Icon` spinner while `isFetchingNextPage`. When `isFetchNextPageError`: a "Couldn't load more" text and a ghost "Retry" button that calls `fetchNextPage()`.

### 4.2 Age label

- Pure `formatTopicAge(updatedAt: Date, now: number)` in `src/lib/topic-age.ts` returns `{ unit: "now" | "m" | "h" | "d" | "w" | "mo", n } | { unit: "date" }` using the PRD R4.2 thresholds (`mo` = floor(days / 30), capped at 11). The row renders units through `t("tree.age.<unit>", { n })` and `date` through next-intl `useFormatter().dateTime(updatedAt, { year: "numeric", month: "2-digit" })`.
- `now` comes from a module-level `useSyncExternalStore` minute clock: one shared `setInterval(60_000)` that starts with the first subscriber and stops with the last, and caches the snapshot per tick. Server snapshot = `0`; rows only exist after the client query, so nothing renders server-side.

### 4.3 Row layout and actions

- Inside `SidebarNavLink`: title `truncate` (flex-1), then a right slot that holds either the age label (`shrink-0 text-xs text-muted-foreground tabular-nums`) or the streaming spinner (R4.4). The fixed spacer at `AssistantTree.tsx:634` goes away.
- Actions (star + "...") sit in one absolutely-positioned group at the row's right edge. They no longer use `showOnHover`, because its `md:opacity-0` is width-based and pins the buttons on narrow screens. Classes:
  - group: `opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100` + visible while the menu trigger is `aria-expanded` (R5.3), and `[@media(hover:none)]:invisible` on touch (R6.1). It uses `invisible`, not `hidden`, so the "..." trigger keeps a layout box and still anchors the menu after a long press. The generated `dropdown-menu.tsx` does not expose `anchor`, and editing `components/ui/` is restricted.
  - age label: the inverse (`group-hover/menu-item:opacity-0`, etc.). Tailwind 4's `hover:` variants only match under `(hover: hover)`, so touch devices always keep the label (R6.1).
  - The overlay takes no layout width (PRD R5.4): only the title (flex-1, truncate) and the age label (shrink-0) share the link's width. The link's padding does not change on hover, so the title's truncation point stays put and the buttons simply cover the age label plus the end of the title. The overlay gets the row's hover/active background (`bg-sidebar-accent` with a short left fade gradient), so covered text does not show through the buttons.
- The star is filled for favorites but no longer pinned visible (R5.2).

### 4.4 Full title (PRD R7)

- **Tooltip, not marquee.** A tooltip shows the whole title at once and works for keyboard focus. It does not depend on motion (`prefers-reduced-motion`), and the hover overlay never covers it. A marquee would scroll under the hover buttons that now cover the end of the title. It also cannot run on touch devices, which have no hover.
- `TopicRow` wraps the link in the shared `Tooltip` primitive (`components/ui/tooltip`), with `side="right"`, so the tooltip opens outside the sidebar and does not cover neighbouring rows. `SidebarMenuButton`'s own `tooltip` prop is not usable: it is hidden unless the sidebar is collapsed (`sidebar.tsx:551`). `SidebarNavLink` may need to forward the trigger props or be replaced by `SidebarMenuButton` + `Link` in the row.
- Truncation is measured when the tooltip is about to open: `onOpenChange(open)` only accepts `open` when the title span's `scrollWidth > clientWidth`. Nothing is measured on render, and no ResizeObserver is used. Open delay ~500 ms, set on this trigger only (the global provider uses `delay=0`).
- Touch: `DropdownMenuContent` starts with a non-interactive `DropdownMenuLabel` header (already exported by the generated `dropdown-menu.tsx:57`). It shows the full title, `line-clamp-3 break-words`, muted, with a separator. The header only renders when the menu was opened by the long press: `TopicRow` keeps `openedByLongPress` state, sets it when the timer fires and clears it when the menu closes. A "..." click or keyboard open shows no header (PRD R7.2).

### 4.5 Long press (inline in `TopicRow`, single use)

- `DropdownMenu` becomes controlled (`open` / `onOpenChange`).
- On the `SidebarMenuItem`: `onPointerDown` with `pointerType === "touch"` stores the start point and starts a 500 ms timer. `pointermove` beyond 10 px, `pointerup` and `pointercancel` clear it. When the timer fires: `setOpen(true)` and set a `suppressClick` ref.
- `onClickCapture`: if `suppressClick`, `preventDefault()` + `stopPropagation()` and reset, so lifting the finger does not navigate (R6.2).
- `onContextMenu`: `preventDefault()` only while a touch press is active (Android fires `contextmenu` on long press). A mouse right-click keeps the browser default (R6.5).
- Row link under `[@media(hover:none)]`: `select-none [-webkit-touch-callout:none]` (R6.4).
- Timers are cleared on unmount.

## 5. Trade-offs

- **No virtualization** (D6): pages of 20 bound the initial render, and the DOM only grows as far as the user scrolls. Virtualizing would also fight the collapse animation and the two-section layout. Revisit if users routinely scroll thousands of rows.
- **Two endpoints rather than one with a `favorite` flag**: favorites are unpaginated and topics are paginated. One route with mode-dependent paging would hide that difference behind a flag.
- **Not-loaded active topic**: if the open topic is beyond the loaded pages, it is not highlighted until it scrolls into range (out of scope).
- **Rename bumps `updatedAt`** (existing behaviour), so a renamed topic shows "now". This is kept as is; changing it is a separate decision.

## 6. Rollback

All changes are in app code plus one index migration. Reverting the commit and the migration restores the full-tree behaviour. The new index is harmless if left in place.
