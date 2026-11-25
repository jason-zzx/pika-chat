# Implementation Plan — Native-like App Navigation

Ordered, incrementally verifiable steps. Do not start until planning artifacts are reviewed and `task.py start` is run.

---

## Step 1: Pure Web Navigation State Machine + Tests

- [ ] Create `src/lib/navigation-state.ts`:
  - `AppNavState`, `MAX_WORKSPACE_TOPICS = 20`, route classifiers (`isSettingsPath`, `isAuthPath`, `isAssistantDraftPath`, `isTopicPath`).
  - Pure transition reducers: `openHome`, `openAssistant`, `openTopic`, `promoteDraftToTopic`, `openSettings`, `switchSettingsTab`, `openProviderDetail`, `purgeTopic`, `purgeAssistant`, `completeAuth`, `resetToAuth`, `syncPathname`, `stepBack`, `canGoBack`.
  - Zod-validated `sessionStorage` load/save/clear helpers.
- [ ] Add comprehensive unit tests in `src/lib/navigation-state.test.ts`:
  - Home root guarantee (including cold-start topic deep link & first-message promotion from `/`).
  - Mobile vs Desktop/Web `/assistant/:a` draft coalescing.
  - Topic back-traversal, move-to-top dedup, and 20-item cap.
  - Settings isolation: tab replace, mobile provider detail 2-step back, return to original topic, `Ctrl+K` cross-jump discarding settings, impossibility of re-entering settings from Home/topic.
  - Auth completion reset, sign-out clear, deleted topic/assistant purge.

## Step 2: Overlay Dismissal Utility + `NavigationProvider` + `pikaNative` Types

- [ ] Extend `src/global.d.ts` with optional `PikaNativeNavigation` (`setCanGoBack`, `onBack`).
- [ ] Create `src/lib/overlay-dismiss.ts` (and `src/lib/overlay-dismiss.test.ts`):
  - Detect open dismissible Base UI overlays (`dialog`, `sheet`, `alert-dialog`, `dropdown-menu`, `popover`, `select`) without matching tooltips.
  - Observe open-state mutations and dispatch `Escape` to dismiss the topmost overlay (verify `AlertDialog`, `Dialog`, `Sheet`, `DropdownMenu`, `Popover`, and `ImagePreviewDialog` all dismiss cleanly).
- [ ] Create `src/components/providers/NavigationProvider.tsx` (and `NavigationProvider.test.tsx`) and mount it inside `src/components/providers/AppProviders.tsx`.
- [ ] Wire call sites to `useAppNavigation()` (preserving standalone browser behavior when `window.pikaNative` is absent):
  - `src/components/assistant/AssistantTree.tsx` (assistant open, topic links, new-topic link, Settings `←` → `goBack`, Assistant `←` → `navigateHome`, delete callbacks).
  - `src/components/layout/SettingsNav.tsx` & `src/components/layout/SidebarNavLink.tsx` (tab `replace`).
  - `src/components/layout/SidebarUserMenu.tsx` (settings entry) & `src/components/layout/CloseOnNavigateLink.tsx` (home reset).
  - `src/components/assistant/SearchDialog.tsx` (topic/message hit navigation, discarding settings).
  - `src/components/provider/ProviderConfigsScreen.tsx` (provider detail & mobile back).
  - `src/components/chat/ChatView.tsx` (notify controller on draft-to-topic `replaceState` promotion).
  - `src/components/auth/{SignInForm,SignUpForm,SetupForm,TwoFactorForm,DemoEntry}.tsx` & `src/lib/sign-out.ts` (auth replace/reset & storage clear).

## Step 3: Shared `shell-ui` Navigation Stack

- [ ] Extend `native/shell-ui/src/host.ts` (`activeServerId` in `listServers`, `returnToServer`, optional `setCanGoBack`, `onBack`).
- [ ] Add localized return copy in `native/shell-ui/src/i18n.ts` (`en` + `zhCN`).
- [ ] Refactor `native/shell-ui/src/main.ts` to maintain `shellStack: ShellScreen[]`:
  - Show Return button on server list when `activeServerId !== null`; clicking the active server resumes without reload.
  - Handle Back / `Escape`: close open `<dialog>` → pop `shellStack` (cancelling in-flight connect if applicable) → at depth 1 call `returnToServer()` when `activeServerId !== null`.
  - Keep `?add` Cancel/Back returning directly to active server when opened standalone, while Save moves to `list`.
  - Refresh `activeServerId` after `saveServer` / `removeServer` and report `setCanGoBack(...)` on every state change.
- [ ] Add unit tests for `shell-ui` stack transitions under `native/shell-ui/src/`.

## Step 4: Desktop Shell (`native/desktop`)

- [ ] Extend `native/desktop/src/preload-remote.ts` with `pikaNative.navigation` (`setCanGoBack`, `onBack`) and `native/desktop/src/preload-shell.ts` with `returnToServer`, `onBack`.
- [ ] Update `native/desktop/src/main.ts`:
  - Detach (do not destroy) `remote.view` in `showShell(query, { dropRemote = false })`; add `returnToServer()`; destroy old `remote` only in `attachServerView`, fatal `dropRemote: true` failures, active-server `removeServer`, or active-server URL origin change in `saveServer`.
  - Keep `remote` name updated if only display name changed.
  - Wire unified `dispatchBack()` to `app-command` (`browser-backward`, swallowing `browser-forward`), macOS `swipe`, and `before-input-event` (`Alt+Left` / `Cmd+[` / `Escape` on shellView; blocking `Alt+Right` / `Cmd+]`), with older-server fallback when `!webNavReady` and root no-op.

## Step 5: Android Shell (`native/mobile`)

- [ ] Update `native/mobile/src/main.ts` to bridge `returnToServer`, `setCanGoBack`, `onBack` via `PikaHost`.
- [ ] Update `native/mobile/android/app/src/main/AndroidManifest.xml` to add `android:enableOnBackInvokedCallback="true"`.
- [ ] Refactor `MainActivity.kt`, `PikaHostPlugin.kt`, and `RemoteBridge.kt`:
  - Keep `bridge.webView` dedicated to `shell-ui`; manage a fresh `remoteWebView` per connected server inside the root `CoordinatorLayout` with shared `BridgeWebChromeClient`, `DownloadListener`, origin/attachment `WebViewClient`, and `RemoteBridge`.
  - Add `returnToServer()`, `setShellCanGoBack()`, and keep-alive `showShell(query, dropRemote = false)`.
  - Destroy `remoteWebView` on new server connect (guarantees clean history & avoids WebView 133 listener crash), active server removal, or active server URL origin change.
  - Sync `backCallback.isEnabled` dynamically from `(shellVisible ? shellCanGoBack : webNavReady ? webCanGoBack : remoteWebView.canGoBack())` so Android 14+ predictive back works natively at root.
  - Keep separate `shellTheme` and `remoteTheme` so background views never flicker system bars.

## Step 6: Verification & Spec Update

- [ ] Run full validation suite:
  - Root web app: `pnpm lint && pnpm typecheck && pnpm test`
  - Native workspace: `pnpm -C native/shell-ui test && pnpm -C native/desktop typecheck && pnpm -C native/desktop test && pnpm -C native/desktop build && pnpm -C native/mobile typecheck && pnpm -C native/mobile build`
  - Android Gradle build (if JDK/Android SDK available in environment): `./gradlew assembleDebug` in `native/mobile/android`
- [ ] Manual verification checklist across Desktop, Android, and Standalone Web covering all Acceptance Criteria in `prd.md`.
- [ ] Update `.trellis/spec/guides/native-shell.md` with the new `pikaNative.navigation` contract, `pikaShell` return contract, Desktop keep-alive/Back interception, and Android dual-WebView + predictive back behavior.

## Risky Files & Rollback Points

| Risk Area | File(s) | Mitigation |
|---|---|---|
| Next.js streaming `ChatView` unmounting on first-message URL change | `src/components/chat/ChatView.tsx`, `NavigationProvider.tsx` | Keep `window.history.replaceState` in `ChatView`; notify controller out-of-band without triggering a Next.js route remount. |
| Base UI `AlertDialog` Escape dismissal | `src/lib/overlay-dismiss.ts` | Verify with jsdom/RTL tests against real `AlertDialog`, `Dialog`, `Sheet`, `DropdownMenu`, `Popover`, `ImagePreviewDialog`. |
| Android `BridgeWebChromeClient` reuse across `remoteWebView` recreations | `MainActivity.kt` | Instantiate `BridgeWebChromeClient(bridge)` once in `onCreate` before `STARTED` and re-attach to each new `remoteWebView`; verify `<input type="file">` upload. |
| Android `SystemBars` insets & IME resize on second `WebView` | `MainActivity.kt` | Mount `remoteWebView` in the same `CoordinatorLayout` parent as `bridge.webView` with `MATCH_PARENT` and verify edge-to-edge + keyboard resize. |
| Older Pika server compatibility | `main.ts`, `MainActivity.kt`, `RemoteBridge.kt` | Gate logical Back dispatch on `webNavReady`; fall back to same-origin `goBack()` when connecting to older servers. |
