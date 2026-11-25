# Temporary chat

## Goal

Let a user start a chat that leaves no trace in their history. It never shows in the topic list, favorites, or search, and its messages and attachments are deleted when the user leaves it or the native app exits, or after 24h of inactivity at the latest.

## Decisions (user)

| ID | Decision |
|---|---|
| D1 | Deleted when the user leaves it; a 24h-inactivity server sweep is the backstop. |
| D2 | No "save as a normal chat" conversion. |
| D3 | Attachments are allowed; they are deleted with the chat. |
| D4 | The desktop (Electron, remote + local mode) and Android (Capacitor) shells clean up on app exit. |
| D5 | Reloading the page or closing the tab or browser counts as leaving and deletes the chat. |
| D6 | Android "exit" = the activity finishing (deleted at once) or the app being swiped away or killed (deleted on the next launch). Going to the background does not delete. |

## Repo Facts

- Generation is server-owned. The send transaction lazily inserts the topic (`src/server/services/generation.service.ts:392`), persists the user message and the reply placeholder, and freezes `historyMessageIds` for the background runner. Stop, resume, regenerate, edit versions, attachments, and compression all read `chat_messages`, so a temporary chat must be a persisted topic.
- `deleteTopic` (`src/server/services/topic.service.ts`) already cancels the topic's active generation and releases unreferenced files. `DELETE /api/topics/:id` exposes it and checks only the session cookie, no origin.
- Topic read surfaces:
  - the paged list and favorites (`topic.service.ts`);
  - title and message search (`search.service.ts:41,60`);
  - per-assistant `topicCount` (`assistant.service.ts:47`).
- Auto-titling runs when `titleCandidate` is true (`src/server/ai/generation-turn.ts:233,241`, `generation-runner.ts:792`).
- The runner's 60s sweep hosts hourly housekeeping (`generation-runner.ts:68-70,214`). `topics.updatedAt` advances on each turn (`generation.service.ts:857`).
- A fresh chat gets its topic id from the `data-topic` stream part, swaps the URL with `history.replaceState`, and records it via `appNav.recordPromotedTopic` (`src/components/chat/ChatView.tsx:463-495`).
- Composer drafts persist per topic (`src/stores/composer-store.ts`).
- Desktop shell:
  - one remote `WebContentsView` at a time, closed by `closeRemote` (`native/desktop/src/main.ts:340,576`);
  - the bridge lives in `preload-remote.ts`;
  - `before-quit` already awaits `localServer.shutdown()` (`main.ts:991`);
  - closing the window hides it to the tray when `closeAction === "tray"` or on macOS (`main.ts:997`).
- Android shell:
  - the bridge is injected by `RemoteBridge.kt` (`addWebMessageListener`, `pikaNativeHost`);
  - native HTTP with WebView cookies exists (`PikaHostPlugin.kt:326`);
  - back at the root falls through to the system: Android ≤ 11 finishes the activity, 12+ only moves it to the background;
  - swiping the app away from recents gives no callback.
- `window.pikaNative` must stay optional (`.trellis/spec/guides/native-shell.md`).

## Requirements

- R1 The new-chat screen (home and assistant draft) has a temporary-chat toggle. The first send creates the topic as temporary. The flag is set only at creation and never changes.
- R2 A temporary topic:
  - is excluded from the topic list, favorites, search, and assistant topic counts;
  - cannot be favorited or renamed;
  - is never auto-titled.
- R3 While a temporary chat (or a draft with the toggle on) is open, the UI shows that it will not be saved.
- R4 Leaving a temporary chat in the web app deletes it and cancels any in-flight reply. Leaving means starting a new chat, opening another topic or assistant, or going to settings. Page unload (reload, closing the tab or browser) also counts as leaving (D5).
- R5 The server deletes temporary topics inactive for more than 24h, together with their attachments.
- R6 Desktop:
  - Quitting the app deletes the temporary chat open in the current server view, in both remote and local mode, before the local server shuts down.
  - Switching servers in the shell counts as leaving.
  - Hiding the window to the tray does not delete.
  - A crash or force kill is left to R5.
- R7 Android (D6):
  - The shell deletes the temporary chat it had open when the activity finishes, on a server switch, and on the next launch after a swipe-away or kill.
  - Going to the background does not delete.
- R8 Composer drafts are not persisted for temporary chats or for drafts with the toggle on.
- R9 Unchanged behavior:
  - normal chats;
  - the web app in a plain browser without a shell;
  - new shells against servers without this feature, and old shells against new servers (beyond R5).

## Acceptance Criteria

- [ ] Sending from the new-chat screen with the toggle on creates a topic that does not appear in the sidebar, favorites, search results, or the assistant's topic count. (R1, R2)
- [ ] A temporary topic keeps the default title; rename and favorite requests return 404. (R2)
- [ ] The temporary notice is visible in the toggled draft and in the temporary chat. (R3)
- [ ] Leaving a temporary chat in the browser, including reload and tab close, removes its topic, messages, and attachment files, and stops an in-flight reply. (R4)
- [ ] A temporary topic idle for more than 24h is removed by the sweep; one active within 24h is kept. (R5)
- [ ] Quitting the desktop app with a temporary chat open removes it, in both remote and local mode. Switching servers removes it; hiding to the tray keeps it. (R6)
- [ ] On Android, a temporary chat open when the app is swiped away is removed on the next launch. Backgrounding and returning keeps it. (R7)
- [ ] No composer draft is restored for a temporary chat. (R8)
- [ ] Normal chats behave as before. Lint, typecheck, and unit + integration tests pass, with integration tests covering exclusion, the rename/favorite guard, no auto-title, and the sweep. (R9)

## Out of Scope

- Converting a temporary chat into a normal one (D2).
- iOS/PWA handling beyond the web behavior (R4).
- Recovering from desktop crashes or force kills other than through the sweep.
- Keeping temporary chats out of server logs or provider-side retention.
