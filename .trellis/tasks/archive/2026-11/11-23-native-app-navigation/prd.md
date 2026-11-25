# Native-like App Navigation

## Goal

Make navigation in the Pika Chat desktop (Electron) and mobile (Android Capacitor) apps behave like a native application rather than a raw browser wrapper, while keeping the standalone web/PWA experience clean and compatible:

- **Home (`/`, New Topic)** is the root of all app navigation and the final stop when pressing Back repeatedly.
- **Settings (`/settings/*`)** is an isolated branch that can never be re-entered by pressing Back from Home or any topic.
- **Server switching (`shell-ui`)** is transactional: backing out without entering another server returns losslessly to the original page; entering a new server clears all navigation history and starts fresh at `/`.

## Decisions (User-Confirmed)

| ID | Decision |
|---|---|
| D1 | **Home as root**: `/` (New Topic) is always the bottom of the workspace navigation stack (`W[0] === "/"`), even when a topic is opened via notification tap or created from `/`. |
| D2 | **Topic back-traversal**: Pressing Back walks backward through previously visited topics one by one until reaching Home (`/`), with move-to-top deduplication and a stack cap (20 entries) to prevent ping-pong loops. |
| D3 | **Empty assistant draft (`/assistant/:a`) handling**: Platform/viewport-aware — on **PC and Web** (sidebar visible, `>= md`), keep `/assistant/:a` in the stack so Back passes through it before Home; on **Mobile** (sidebar hidden in drawer, `< md`), coalesce/replace an empty `/assistant/:a` when opening a topic so Back returns directly from the topic to Home (`/`). |
| D4 | **Sidebar "Back to Assistants" (`←`)**: Clicking `←` in an assistant pane returns to Home (`/`) and resets the workspace stack to `["/"]`. |
| D5 | **Settings isolation & return target**: Switching top-level settings tabs replaces in place; pressing Back from Settings returns to the original topic (or Home) where Settings was opened and removes Settings from history. Once on Home or any topic, Back (and Forward) can never return to Settings. |
| D6 | **Transactional server switching**: Opening the server list or add-server screen keeps the active server alive. Backing out without connecting to another server (or selecting the same unchanged server) returns losslessly to the original page. Connecting to a new server destroys the old server instance and clears all navigation history. |
| D7 | **Editing/removing the active server**: Removing the currently connected server OR editing its URL immediately disconnects the active server (cannot return to the old page; must reconnect). Editing only its display name keeps the connection returnable. |
| D8 | **Root Back behavior**: On **Android**, pressing Back at the root exits directly to the home screen (supporting Android 14+ predictive back). On **PC (Desktop)**, pressing Back at the root is a **no-op** (never closes or hides the window). |
| D9 | **Overlays consume Back first**: Native server switcher popup, `shell-ui` dialogs, Web modals/dialogs/image preview/dropdowns/popovers, and the mobile sidebar drawer close before any route navigation occurs. |
| D10 | **Standalone Web compatibility**: Plain browser/PWA users (without `window.pikaNative`) keep standard browser history usability while benefiting from clean `replace` transitions on settings tabs, auth completion, and deletions. |

## Confirmed Repo Facts

- **Next.js App Router web app** (`src/app/(app)/` and `src/app/(auth)/`):
  - Routes: `/`, `/assistant/[assistantId]`, `/assistant/[assistantId]/[topicId]`, `/settings/{general,models,account,files,providers,search,users,about}`, `/settings/providers/[configId]`, `/sign-in`, `/sign-up`, `/setup`, `/two-factor`.
  - [AssistantTree.tsx](src/components/assistant/AssistantTree.tsx#L131-L141) hardcodes `router.push("/")` on both Settings `←` and Assistant `←`, pushing `/` on top of Settings and causing Back from Home to re-enter Settings.
  - [SettingsNav.tsx](src/components/layout/SettingsNav.tsx#L70-L79) and [SidebarNavLink.tsx](src/components/layout/SidebarNavLink.tsx#L26-L29) push every settings tab click onto history.
  - [SearchDialog.tsx](src/components/assistant/SearchDialog.tsx#L125-L146) is globally mounted ([AppShell.tsx](src/components/layout/AppShell.tsx#L53)) and uses `router.push`, which leaves `/settings/*` behind a topic when jumping out of Settings.
  - [ChatView.tsx](src/components/chat/ChatView.tsx#L488-L492) uses `window.history.replaceState` when promoting a new chat to `/assistant/:a/:t`, overwriting `/` at the bottom of history.
  - Auth forms ([SignInForm.tsx](src/components/auth/SignInForm.tsx#L61), `SignUpForm`, `SetupForm`, `TwoFactorForm`, `DemoEntry`) and delete fallbacks ([AssistantTree.tsx](src/components/assistant/AssistantTree.tsx#L111-L124)) use `router.push`, leaving `/sign-in` or deleted URLs in history.
  - All web modals, sheets, alert dialogs, dropdown menus, and popovers use `@base-ui/react` (`src/components/ui/{dialog,sheet,alert-dialog,dropdown-menu,popover,select}.tsx`), including `ImagePreviewDialog` and the mobile sidebar sheet.
- **Desktop shell** (`native/desktop/src/main.ts`):
  - Uses separate Electron `WebContentsView`s (`titlebarView`, `shellView`, `serverMenuView`, and `remote.view`).
  - [main.ts](native/desktop/src/main.ts#L337-L342) calls `closeRemote()` immediately inside `showShell()`, destroying the active server view the moment the user opens `?list` or `?add`.
  - No explicit handling for mouse side buttons (`app-command` `browser-backward`/`browser-forward`), macOS trackpad `swipe`, or `Alt+Left` / `Cmd+[`.
  - Window close already respects `config.closeAction` (`"tray"` vs `"quit"`) at [main.ts](native/desktop/src/main.ts#L799-L809).
- **Android shell** (`native/mobile/android/...`):
  - Single Capacitor `bridge.webView` currently loads both `https://localhost` (`shell-ui`) and remote server origins.
  - [MainActivity.kt](native/mobile/android/app/src/main/java/io/github/jasonzzx/pikachat/MainActivity.kt#L41-L63) falls back to `showShell("?list")` when connected-origin history ends, and backgrounds the app when Back is pressed on `shell-ui` (even when a server is connected).
  - [connectToServer](native/mobile/android/app/src/main/java/io/github/jasonzzx/pikachat/MainActivity.kt#L123-L126) does not clear WebView history when switching servers.
  - `AndroidManifest.xml` does not yet set `android:enableOnBackInvokedCallback="true"`.
  - Per `.trellis/spec/guides/native-shell.md`, remote pages never receive the Capacitor bridge; `shell-ui` relies on Capacitor's `PikaHostPlugin` and `CapacitorHttp`; unregistering a WebView `WebMessageListener` without adding a new one crashes WebView 133.
- **Shared shell UI** (`native/shell-ui/src/main.ts`):
  - Renders `welcome`, `list`, `form` (add/edit), `mobileSettings`, `connecting`, `versionWarning`, and `error` by replacing `document.body` without an internal back stack or a "return to active server" action.

## Requirements

- **R1 — Root Home & Topic Back-Traversal**:
  - In `app` mode, `workspaceStack[0]` is always `"/"`.
  - Sending the first message from `/` keeps `ChatView` mounted without interrupting streaming while ensuring `/` stays beneath the new topic so Back returns to `/`.
  - Switching between topics pushes onto the workspace stack with move-to-top deduplication and a cap of 20 entries above `"/"`.
  - Opening a topic (or sending the first message) from an empty assistant draft `/assistant/:a` replaces `/assistant/:a` on mobile viewports (`< md`), and preserves `/assistant/:a` on desktop/web viewports (`>= md`).
  - Clicking the assistant sidebar `←` button or brand logo returns to `/` and resets `workspaceStack` to `["/"]`.
  - Opening a topic from a notification tap guarantees `"/"` remains beneath it.
- **R2 — Platform-Appropriate Root Exit**:
  - On Android, pressing Back at root (`/` in app mode, `/sign-in` or `/setup` in auth mode, or `shell-ui` root when no server is connected) with no open overlays delegates to Android OS so the app exits directly to the home screen with Android 14+ predictive back animation.
  - On PC (Desktop), pressing Back (mouse side button, `Alt+Left`, `Cmd+[`, macOS swipe) at root is a no-op and never closes or hides the window. Forward navigation (`browser-forward`, `Alt+Right`, `Cmd+]`) is disabled in desktop native mode.
- **R3 — Settings Branch Isolation**:
  - Settings lives in a separate branch (`settingsStack`) above `workspaceStack`.
  - Switching between top-level settings sections (`/settings/general`, `models`, `account`, `files`, `providers`, `search`, `users`, `about`) replaces the settings entry rather than pushing.
  - On narrow/mobile viewports, entering `/settings/providers/[configId]` pushes a second settings layer; Back returns to `/settings/providers`, then the next Back exits Settings. (On desktop split-pane, selecting a provider replaces in place.)
  - Leaving Settings via Back or the Settings sidebar `←` button restores the exact topic (or Home) from which Settings was entered and discards `settingsStack`.
  - Leaving Settings via cross-jump (e.g., `Ctrl+K` SearchDialog) discards `settingsStack` and navigates to the target topic.
  - From Home or any topic, pressing Back (or Forward) can never enter `/settings/*`.
- **R4 — Overlay-First Back Consumption**:
  - Back closes open overlays before any route change, in priority order: (1) native server menu popup, (2) `shell-ui` confirm `<dialog>`, (3) Web modal/alert-dialog/image-preview/dropdown/popover, (4) mobile sidebar drawer.
- **R5 — Transactional Server Switching (`shell-ui`)**:
  - Opening the server list or add-server screen keeps the currently connected server alive without destroying or reloading it.
  - `shell-ui` maintains an internal sub-screen stack (`list` → `form` / `mobileSettings` / `connecting` / `versionWarning` / `error`). Back / `Esc` pops sub-screens back to `list`, and Back from the bottom of `shell-ui` (or clicking the explicit return button) dismisses `shell-ui` and restores the active server losslessly.
  - Opening `?add` directly from the quick server menu: Cancel/Back returns directly to the active server; Save transitions to `list`.
  - Clicking the currently connected server in `list` (with unchanged URL) dismisses `shell-ui` and resumes it without reload.
  - Connecting to a new server fails/is cancelled → user can back out to `list` and still return to the previously connected server.
  - Connecting to a new server succeeds → old server instance is destroyed, all navigation state and WebView/WebContents history are cleared, and the new server starts fresh at `/`.
  - Deleting the currently connected server OR changing its URL immediately disconnects the active server so returning to the old page is disabled.
- **R6 — Auth & Stale-Route Hygiene**:
  - Auth sub-pages (`/sign-up`, `/two-factor`) pop back to `/sign-in`; completing sign-in, sign-up, setup, 2FA, or demo entry resets to `app` mode at `["/"]` so Back never returns to auth pages.
  - Signing out resets to `auth` mode at `["/sign-in"]` and clears workspace/settings history.
  - Deleting a topic or assistant purges deleted entries from `workspaceStack` so Back never revisits deleted URLs.
- **R7 — Backward Compatibility & Standalone Web**:
  - `window.pikaNative` remains optional; standalone Web/PWA browsers work normally with browser Back/Forward while adopting clean `replace` hygiene for settings tabs, auth completion, and deletions.
  - Newer native shells connecting to older Pika servers (without the new `navigation` bridge) fall back cleanly to same-origin history back without breaking navigation.

## Out of Scope

- Adding browser-style Back/Forward buttons to the Desktop titlebar (`titlebar.ts` stays minimal).
- Multi-window desktop support or iOS native app.
- Double-press-to-exit toast on Android (user selected direct exit to home screen with predictive back).
- Changing server-side routes or URL structure.

## Acceptance Criteria

- [ ] **Home root & topic trace-back**: Visiting `/` → `t1` → `t2` → `t3` and pressing Back traverses `t3` → `t2` → `t1` → `/`; on Android the next Back exits directly to the launcher (with predictive back when supported); on Desktop the next Back is a no-op.
- [ ] **First message from Home**: Sending a first message on `/` streams uninterrupted and promotes the URL to `/assistant/:a/:t`; pressing Back returns to `/` (New Topic).
- [ ] **Assistant draft platform split**: From `/` → `/assistant/a` → `/assistant/a/t1`, pressing Back on PC/Web (`>= md`) visits `/assistant/a` then `/`, while on Mobile (`< md`) it returns directly to `/`.
- [ ] **Topic dedup & sidebar reset**: Alternating `t1 ↔ t2 ↔ t1` does not loop on Back (`t1 → t2 → /`); clicking the assistant pane `←` resets to `/` so the next Back triggers root behavior.
- [ ] **Settings isolation**: Opening Settings from `t2`, switching across multiple settings tabs, and pressing Back (or clicking Settings `←`) returns to `t2` in one step (two steps if inside mobile `/settings/providers/[configId]`); pressing Back again goes `t2 → t1 → /` and never re-enters `/settings/*`. Jumping from Settings to `t3` via `Ctrl+K` also never allows Back to re-enter `/settings/*`.
- [ ] **Overlays first**: On Android (and Desktop Back), pressing Back closes an open image preview, search dialog, dropdown menu, confirm dialog, or mobile sidebar drawer without navigating the underlying route.
- [ ] **Server switcher lossless return**: On both Desktop and Android, opening "Manage servers" or "Add server" from an active topic and pressing Back / Cancel / `Esc` returns to the exact same topic without reloading or losing unsent draft/scroll/streaming state.
- [ ] **Server switcher clean reset**: Entering a different server clears all prior navigation history and starts at `/` of the new server (pressing Back on `/` triggers root exit/no-op, never returning to the old server or `shell-ui`).
- [ ] **Server removal & URL edit**: Deleting the active server or editing its URL disconnects the active server immediately and removes the ability to return to the old page; editing only its name keeps lossless return intact.
- [ ] **Auth & deletion hygiene**: After logging in, pressing Back from `/` does not return to `/sign-in` or `/two-factor`; after deleting a topic or assistant, pressing Back does not navigate back to the deleted URL.
- [ ] **Standalone web & tests**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm -C native ...` typecheck/tests/builds pass; plain browser usage works without regressions.
