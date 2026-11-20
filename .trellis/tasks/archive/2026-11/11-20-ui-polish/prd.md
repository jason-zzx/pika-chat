# UI hover, layout & visual consistency polish

## Goal

Unify split-hover row interactions across the web app and native `shell-ui`, align dialogs and confirmation flows with the global design system, and polish desktop/mobile layout, sidebar spacing, composer, chat map, and settings ergonomics in a single cohesive task (no subtasks).

## Requirements

### 1. Unified Row Hover & Action Highlighting

- **R1.1 Sidebar user + settings row (`SidebarUserMenu`)**:
  - In expanded mode (`not-group-data-[collapsible=icon]`), the username dropdown trigger and settings link share one seamless row surface with unified hover and menu-open background (`--sidebar-accent`) and no inter-button gap breaking the background.
  - The settings button mirrors topic row trailing actions (`rounded-full`, `size-7 md:size-6`, `text-sidebar-foreground/60`, `hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground`) so its highlight sits gracefully inside the row without colliding with the outer corners.
  - In icon-collapsed mode (`group-data-[collapsible=icon]:flex-col`), the stacked icon buttons retain independent rounded-square button hover states.
- **R1.2 Native shell server list rows (`native/shell-ui`)**:
  - Every `.row` (both the local `"This computer"` entry and remote server entries) highlights the entire row uniformly on hover (`--accent`) without an unhighlighted outer gutter.
  - Trailing row buttons (`Edit`, `Remove`) display an extra layered hover tint on top of the row hover (`color-mix(in oklch, var(--foreground) 8%, transparent)`), with destructive tint on `Remove`, without dropping the row highlight.
- **R1.3 Sidebar assistant profile + delete row (`AssistantTree`)**:
  - The profile button keeps the row's `--sidebar-accent` highlight when hovering its trailing delete action (`group-hover/menu-item`), even when the delete button is disabled (`isLastAssistant`), and the delete button uses a layered rounded-full hover (`hover:bg-sidebar-foreground/10`).
- **R1.4 Tool call overlay header (`ToolCallShell`, `FetchToolCall`)**:
  - In `headerMode="overlay"`, hovering the interactive `pointer-events-auto` page-title button keeps the header's `bg-accent/50` row background active (`group/header`), and the header toggle's corner radius adapts to collapse state (`rounded-t-lg` when expanded, `rounded-lg` when collapsed).
- **R1.5 Search palette results (`SearchDialog`)**:
  - Mouse hover updates/syncs the active result highlight (`bg-accent`) so pointer hovering never goes unhighlighted or leaves a stale second highlight row.
  - Add an inline clear button (`X`) in the search input when `query.length > 0`.
- **R1.6 Provider model delete button & QuoteCard hover (`ProviderConfigsScreen`, `QuoteCard`)**:
  - Replace the literal `×` character with `XIcon` and fix dark-mode hover contrast on the model row remove button so it stays distinguishable over `bg-muted/50`.
  - Add subtle hover background (`hover:bg-accent/50`) to `QuoteCard`'s jump button so both sides of the card feel cohesive.

### 2. Visual System Consistency & Dialog Alignment

- **R2.1 External link modal alignment (`ExternalLinkDialog`, Streamdown `linkSafety`, `SearchToolCall`)**:
  - Refactor `ExternalLinkDialog` to use the standard `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, and `Button` primitives (`bg-popover`, `bg-black/10` overlay, `ring-1 ring-foreground/10`), keeping backdrop-click close, copy feedback, and long-URL scrollable box.
  - Preserve `Markdown.tsx`'s `linkSafety.renderModal` delegation to `ExternalLinkDialog`, and intercept click navigation on `SearchToolCall` result links (`event.preventDefault()`) so Streamdown markdown links, `CitationSup` chips, `FetchToolCall` links, and `SearchToolCall` result links all share the same confirmation dialog.
- **R2.2 Native shell UI modal, focus & interactive polish (`native/shell-ui`)**:
  - Restore `cursor: pointer` on enabled `.btn` and `.row-main` elements.
  - Replace browser `window.confirm()` on server removal with a styled `<dialog class="confirm-dialog">` using native `returnValue` + `close()`, matching the shell's card/button tokens.
  - Do not auto-focus the first local server item when entering `showList()` (eliminates the initial focus border on load), scope row focus highlight to `.row:has(:focus-visible)` with inset `outline-offset: -2px`, collapse empty `.message:empty` height, refine narrow-screen spacing, and add pending feedback when checking for updates.
- **R2.3 Admin password reset dialog & table polish (`AdminUsersScreen`)**:
  - Replace `window.prompt()` with a proper `Dialog` password form (`type="password"`, `minLength={8}`, inline validation/error, pending submit state, localized en + zh-CN copy).
  - Mark the `Ban` menu item with `variant="destructive"` and add subtle hover highlighting (`hover:bg-muted/40`) on user table rows.
- **R2.4 Search provider delete confirmation (`SearchProvidersScreen`)**:
  - Add an `AlertDialog` confirmation before deleting a configured search provider and style the delete trigger/confirm actions with destructive affordance.
- **R2.5 Account settings card hierarchy (`TwoFactorCard`)**:
  - Compose `SettingsSection` + `SettingsCard` in `TwoFactorCard` so its section title and description sit outside the card, matching the Password section above it.
- **R2.6 Manual history compression confirmation (`ChatView` + `AlertDialog`)**:
  - Clicking the composer's manual "Compress context" button opens an `AlertDialog` confirmation modal instead of triggering compression immediately.
  - The modal explains that earlier conversation turns will be summarized into context and locked against deletion/regeneration while keeping full visible message history (`en` + `zh-CN` copy), with Cancel and Confirm actions (Confirm closes the dialog and triggers compression; dismissing/canceling leaves the conversation untouched).

### 3. Layout, Sidebar, Chat & Settings Ergonomics

- **R3.1 `ThemeControl` icon-collapse label (`ThemeControl`)**:
  - Keep `ThemeControl` on its own sidebar footer row as currently designed; add `group-data-[collapsible=icon]:hidden` to its label `<span>` so it hides cleanly when collapsed.
- **R3.2 Desktop settings header removal & collapsed-sidebar handling (`SettingsLayout`, `AppShell`, `Sidebar`)**:
  - Hide `<InsetHeader />` on desktop (`md:hidden`) in `SettingsLayout` to eliminate the empty top bar above `PageHeader`, while keeping `<InsetHeader />` visible on mobile (`< md`) so the drawer trigger remains reachable.
  - On desktop `/settings/*` routes, force-display the sidebar expanded, hide `SidebarRail`, and ignore collapse shortcuts (`Ctrl/Cmd+B`) **without** mutating the chat view's persisted `sidebar_state` cookie—so navigating into Settings from a collapsed chat sidebar shows the full settings nav, and navigating back to chat restores the user's collapsed state.
- **R3.3 Sidebar list spacing (`SidebarMenu`)**:
  - Change desktop menu item spacing from `md:gap-0` to `md:gap-0.5` so topic rows, assistant rows, footer rows, and left-side `SettingsNav` items all have crisp visual separation.
- **R3.4 `PaneHeader` truncation, collapsed topic hiding & skeleton height (`AssistantTree`)**:
  - Add `flex-1` to `PaneHeader`'s title `<span>` while keeping `flex-wrap` for icon-collapsed stacking compatibility so long names truncate instead of wrapping below the back button.
  - Hide the topic list `SidebarGroup` when the sidebar collapses to icon mode (`group-data-[collapsible=icon]:hidden`) and add tooltips on "New topic" / "Profile" icon buttons.
  - Align `LoadingRows` with `SidebarMenu` + `SidebarMenuItem` (`h-10 md:h-8` slot height, `h-4` title bar) so skeleton rows match loaded topic/assistant rows without extra nested `SidebarGroup` padding or blocky height jumps.
- **R3.5 Composer & inline message editor polish (`Composer`, `UserMessageEditor`)**:
  - Add `focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20` on the composer and inline editor outer cards.
  - Harmonize the composer's right-hand toolbar spacing (`gap-1` / clear separation before the Send/Stop button), align the Expand toggle size (`size="icon-sm"`), enlarge mobile toolbar icon targets to `size-9 md:size-7 [&_svg]:size-5 md:[&_svg]:size-4` (including `ModelPicker`, `SearchModePicker`, `ImageParamsPicker`, `ComposerSelectTrigger`, and `UserMessageEditor` attach button), and focus the textarea when clicking blank space in the bottom action bar (`pointer-events-none` control groups over a `tabIndex={-1} aria-hidden="true"` `cursor-text` overlay button).
- **R3.6 Message actions & image-edit button legibility (`MessageActions`, `MessageItem`)**:
  - Give `MessageActions` buttons `hover:bg-accent` feedback and slightly larger desktop hit padding (`md:p-1` inside a compact row) so icon targets feel crisp and responsive.
  - Give the image-thumbnail "Edit this image" overlay button a subtle border, translucent backdrop, and shadow (`border border-border/60 bg-background/85 shadow-xs backdrop-blur-xs hover:bg-background`) so it stays legible over light images.
- **R3.7 `ChatMapDialog` hover & polish (`ChatMapDialog`)**:
  - Add smooth hover, active, and focus-visible states (`group/map-row`, `gap-1.5`, crisp pill transitions) without adding message index numbers or role labels/badges, and preserving user (`bg-muted font-medium`) vs assistant (`border border-border`, non-`bg-muted`) styling.
- **R3.8 Files list & model preferences ergonomics (`FilesList`, `FilesScreen`, `ModelPreferencesScreen`)**:
  - Show the select-all label alongside the header checkbox in `FilesList`, and integrate the active selection count + `Delete` / `Cancel` actions into that same header bar so selecting files does not shift the file card vertically; add `hover:bg-muted/30` to `FileRow`.
  - Disable "Reset all" in `ModelPreferencesScreen` when all model preference slots are already unset.

## Acceptance Criteria

- [x] All split-hover rows (`SidebarUserMenu`, `native/shell-ui` server rows, `AssistantTree` profile row, `ToolCallShell` overlay header, `SearchDialog` results, `ProviderConfigsScreen` model row, `QuoteCard`) exhibit unified row-level hover with clean secondary button feedback in both light and dark modes.
- [x] `ExternalLinkDialog` uses standard `AlertDialog` + `Button` styling across Streamdown markdown links, citation chips, fetch tool blocks, and `SearchToolCall` result links.
- [x] Native `shell-ui` uses `cursor: pointer`, styled in-app `<dialog>` confirmation modal (no `window.confirm`), clean form spacing, update-check feedback, and no initial auto-focus ring on `showList()`.
- [x] `AdminUsersScreen` password reset uses a `Dialog` form (no `window.prompt`), `SearchProvidersScreen` confirms before deletion, `TwoFactorCard` uses `SettingsSection` + `SettingsCard`, and manual "Compress context" in `ChatView` opens an `AlertDialog` confirmation before firing `compressTopic`.
- [x] Desktop `/settings/*` hides the redundant top bar (`md:hidden` on `InsetHeader`), keeps mobile drawer accessible, keeps settings sidebar expanded regardless of prior chat collapse state, and restores collapsed chat state upon leaving `/settings/*`.
- [x] `SidebarMenu` uses `md:gap-0.5` across topic lists and `SettingsNav`; `ThemeControl` hides its label cleanly in icon-collapsed mode; `PaneHeader` truncates long titles; collapsed sidebar hides topics; `LoadingRows` matches topic/assistant item height.
- [x] `Composer`, `UserMessageEditor`, `MessageActions`, image edit overlay, `ChatMapDialog` (no index/role badges), `FilesList`/`FilesScreen` (no layout jump on selection), and `ModelPreferencesScreen` all reflect the specified refinements cleanly at both desktop and mobile breakpoints.
- [x] `messages/en.json` and `messages/zh-CN.json` are key-identical; `pnpm lint`, `pnpm typecheck`, `pnpm check:themes`, DOM/i18n Vitest suites, and native `shell-ui` checks (`test`, `typecheck`, `build`) pass (with full Postgres integration tests requiring an external DB outside the sandbox).
