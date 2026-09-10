# Topic favorites: pin favorite topics to top of topic list

## Goal

Users can mark topics as favorites so that important conversations stay reachable at the top of the sidebar topic list instead of drifting down as other topics gain activity. Favorited topics render in a collapsible "Favorite" section above the "Topics" section, as a peer (sibling) section at the same level. Favoriting is a lightweight, reversible action available everywhere a topic row is shown in the sidebar.

## Background / Confirmed Facts

- The topic list lives in `AssistantPane` (`src/components/assistant/AssistantTree.tsx:277-374`): a "Topics" `SidebarGroupLabel` + `SidebarMenu` of topic rows under the currently viewed assistant. Each row has a `SidebarNavLink` plus a hover `SidebarMenuAction` "..." opening a `DropdownMenu` with Rename / Delete.
- Topics are persisted in PostgreSQL (`topics` table, `src/server/db/schema/assistant.ts:30-42`): `id`, `assistantId`, `title`, `createdAt`, `updatedAt`. No favorite/pin field exists anywhere in the codebase (greenfield feature).
- List ordering is server-side in `selectTree` (`src/server/services/assistant.service.ts:118`): `orderBy(asc(assistants.createdAt), desc(topics.updatedAt))`. `topics.updatedAt` is the de-facto "last active time" (bumped by chat/regenerate via `touchTopicUpdatedAt`; also bumped by rename).
- Topic ownership is single-chain (topic → assistant → `ownerId`), so a per-topic boolean is sufficient; no user-favorites join table is needed.
- UI strings are hardcoded English inline (no i18n framework). The user specified the section label text: `Favorite`.
- Multi-entry confirmation from user: favorite toggle must be available BOTH in the "..." dropdown menu AND as a hover icon on the topic row.

## Requirements

### R1 — Favorite toggle entry points (both required)

- **R1a Dropdown menu**: the "..." `DropdownMenu` on each topic row gains a favorite toggle item above Rename:
  - Not favorited → item "Favorite" with an outline star icon.
  - Favorited → item "Unfavorite" with a filled star icon.
- **R1b Hover icon**: each topic row shows a star icon `SidebarMenuAction` (`showOnHover`) next to the "..." trigger:
  - Not favorited → outline star, visible on hover.
  - Favorited → filled star; the button stays visible without hover (state signal, per the fill-vs-outline preference).
  - Click toggles favorite state.

### R2 — Persistence

- Favorite state persists across sessions in PostgreSQL: new non-null boolean column `is_favorite` on `topics`, default `false`, via generated Drizzle migration.
- Toggling favorite must NOT bump `topics.updatedAt` (it is not conversation activity and would reshuffle ordering).
- Only the owning user can toggle a topic's favorite state (server-side ownership check, same pattern as `renameTopic`).

### R3 — Favorite section pinned above Topics (user requirement #3, structure reverted to the original decision)

- The topic list renders two **peer (sibling) collapsible sections** in this order: "Favorite" first (pinned at the top), then "Topics". Both labels sit at the same hierarchy level — "Favorite" is NOT nested/indented under "Topics".
- When the assistant has no favorited topics, the "Favorite" section (label included) is not rendered at all — apart from the labels becoming collapsible toggles (R6), the list looks as today.
- Favorited topics are NOT duplicated in the normal rows of the "Topics" section below (置顶 = moved into the Favorite section).
- The "Topics" label is ALWAYS rendered, even when every topic is favorited and its list is empty.
- The "No topics yet" empty state only appears when the assistant has zero topics total.
- Section collapse semantics (independent, peer-level):
  - Collapsing "Favorite" hides only the favorited topic rows.
  - Collapsing "Topics" hides only the normal (non-favorite) topic rows — it does NOT hide the Favorite section.

### R4 — Ordering within favorites (user requirement #4)

- Topics inside the "Favorite" subsection are sorted by last active time (same `topics.updatedAt` descending order as the normal list).
- The normal (non-favorite) topic rows keep their current ordering and are simply the remaining topics in existing order.

### R5 — Feedback & consistency

- Toggling updates the UI immediately (optimistic update with rollback on failure), following the existing `useSetAssistantDefaultModel` pattern in `src/components/assistant/use-assistants.ts:67-127`.
- Favorite state survives tree refetches (server-authoritative via `selectTree` returning `isFavorite`).
- Keyboard accessible: the hover star is a real button with an `aria-label` (e.g. `Favorite <topic title>` / `Unfavorite <topic title>`); the dropdown item is keyboard reachable as today.

### R6 — Collapsible section labels with arrow state

- Both "Favorite" and "Topics" are peer section headers: each is a toggle control with an arrow (chevron) that indicates and animates the expanded/collapsed state, following the app's existing collapse convention (`ToolCallShell`: chevron icon + rotation transition, `aria-expanded`/`aria-controls`, `motion-reduce` support).
- The two labels are styled identically (same size/weight/left padding) — no indentation or other visual subordination of one to the other.
- Keyboard accessible: both labels are real buttons, reachable and activatable, with accessible names.
- Default state on first-ever render: both expanded.
- Persistence: collapse state is stored in localStorage, shared globally across all assistants (one state for "Topics", one for "Favorite"). SSR-safe: first paint renders the default (expanded), the persisted value applies after mount (same profile as the established `SearchModePicker` pattern); no hydration mismatch.

## Out of Scope

- No favorite/star affordance inside the chat view header — sidebar only.
- No cross-assistant global favorites section on the assistants home pane.
- No drag-to-reorder, manual ordering, or per-favorite ordering overrides.
- No i18n framework; strings stay hardcoded English like the rest of the UI.

## Acceptance Criteria

- [ ] With no favorites, the topic list renders identically to today except that the "Topics" label is now a collapsible toggle (default expanded, arrow shown).
- [ ] Hovering a topic row shows both a star button and the "..." menu trigger; clicking the star favorites the topic: it immediately moves into the "Favorite" section (rendered above the "Topics" section) showing a filled star, without a refetch flicker.
- [ ] The "..." menu shows "Favorite" for unfavorited topics and "Unfavorite" for favorited ones; activating it toggles the same state as the hover star.
- [ ] With ≥1 favorite, the "Favorite" section appears as a peer section above "Topics"; unfavoriting the last favorite removes the section entirely (no empty section, no layout shift beyond the section disappearing).
- [ ] Favorites are ordered by last active time (most recent `updatedAt` first); sending a message in a favorited topic keeps it in the Favorite section and re-sorts it to the top of that section.
- [ ] A favorited topic does not appear a second time in the normal topic rows.
- [ ] When ALL topics are favorited, the "Topics" label remains visible below the Favorite section (its list is empty); no "No topics yet" empty state is shown.
- [ ] Clicking the "Favorite" label collapses/expands only the favorited rows; clicking the "Topics" label collapses/expands only the normal rows (the other section is unaffected); both toggles are keyboard operable with `aria-expanded`.
- [ ] The two labels are visually peers: same font size/weight and identical left alignment; "Favorite" is not indented under "Topics".
- [ ] Favoriting does not change the topic's position-by-updatedAt in a way implied by bumping `updatedAt`: toggling favorite on an old, inactive topic does not reorder it to the top of the normal list when unfavorited again.
- [ ] Favorite state persists after page reload and across sessions; another account's API call to toggle someone else's topic fails (404, ownership enforced).
- [ ] Collapse state persists in localStorage across reloads/sessions and applies consistently when switching assistants; server-rendered HTML always shows the default (expanded) with no hydration errors.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; migration applies cleanly.
- [ ] Star button and menu item are keyboard reachable and have accessible labels.

## Open Questions

None — entry points (dropdown + hover icon), section label text ("Favorite"), placement as a peer section above "Topics", hiding-when-empty, updatedAt-desc ordering, Topics-label-always-visible, collapsible labels with arrows, and global localStorage persistence of collapse state are all decided by the user.
