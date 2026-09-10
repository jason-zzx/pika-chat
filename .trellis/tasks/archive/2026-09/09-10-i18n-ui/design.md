# Design — i18n-ui (all remaining screens)

> Conforms to parent `../09-10-i18n/design.md` (§3 namespaces, §6 timestamps, §8 testing) and to `.trellis/spec/frontend/i18n.md` (the binding conventions). This file fixes the batch split, per-batch scope, and the timestamp refactor contract.

## Batch split (sequential; commit per batch by the main session)

| # | Batch | Scope | Namespaces |
|---|---|---|---|
| 1 | auth + account | `components/auth/*` (SignInForm, SignUpForm, SetupForm, CredentialsForm, SignOutButton), `components/account/ChangePasswordForm.tsx`, `app/(auth)/{layout,setup/page,sign-in/page,sign-up/page}.tsx`, `app/(app)/settings/account/page.tsx`, `lib/auth-client.ts` (`SIGN_IN_FAILED_MESSAGE`) | `Auth`, `Account` |
| 2 | chat | `components/chat/*` user-facing files incl. the core-task leftovers: `ChatView.tsx` ("The message is still being saved…"), `MessageItem.tsx` stream-failure chrome ("Thinking…", "The model failed to respond."), Composer, MessageList, MessageActions, ModelPicker, AssistantPicker, SearchModePicker, ComposerPickerContent, ComposerSelectTrigger, ToolCallShell, FetchToolCall, SearchToolCall, ReasoningBlock, ExternalLinkDialog, ChatMapDialog, CitationSup, Markdown/citations if user-visible; `components/topic/{RenameTopicDialog,DeleteTopicDialog}.tsx` | `Chat.*`, `Topic` |
| 3 | settings + admin + provider + search | remaining `app/(app)/settings/**` pages, `components/admin/*` (AdminUsersScreen, RegistrationToggle), `components/provider/*` (ProviderConfigsScreen, ProviderConfigForm, ModelEditorDialog incl. its client-side validation strings, DiscoverModelsSheet), `components/search/SearchProvidersScreen.tsx` | `Settings.*`, `Admin`, `Provider`, `Search` |
| 4 | timestamps (R6) | `lib/message-time.ts` + `components/chat/MessageTimestamp.tsx` (+ their tests) | `Chat.Timestamp` |

## Catalog rules

- `messages/en.json` + `messages/zh-CN.json` in the same change as the component that uses the key; no orphan keys (an `en` key must have a `zh-CN` counterpart).
- Only the namespaces above; do not rename keys established by `i18n-core`. Add new entries under the matching existing namespace.
- Error text is already key-based (`errors` contract): do not introduce new hardcoded fallbacks — call `apiErrorMessage(caught, t, fallbackKey)` with an existing `Errors.actions.*` key.
- Proper nouns stay untranslated: model IDs, vendor names, assistant/user data, native locale labels.
- Keep `"use client"` where it is; copy migration must not widen the client boundary.

## Timestamp contract (R6, parent design §6 — behavior-preserving)

- `src/lib/message-time.ts` becomes locale-agnostic: keep `parseTimestamp`; replace `formatMessageAge`/`formatMessageExact` with a pure descriptor:
  `getMessageAge(iso, now) -> { kind: "justNow" } | { kind: "minutes", count } | { kind: "hours", count } | { kind: "date", date, withYear } | undefined`
  Thresholds unchanged (just now < 1 min; N minutes < 1 h; N hours < 1 day; else short date + year when different year).
- `MessageTimestamp.tsx`: `useNow({ updateInterval: 30_000 })` replaces the manual `setInterval`/`useState`; label via `useTranslations("Chat.Timestamp")` (ICU plural keys + a `justNow` key); date via `useFormatter().dateTime(date, { month: "short", day: "numeric", ...(withYear && { year: "numeric" }), timeZone })`; tooltip via `format.dateTime` (2-digit fields, `hourCycle: "h23"`) — both with `timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone` to keep today's local-time behavior and avoid next-intl's missing-timeZone warning.
- Tests: `message-time.test.ts` asserts descriptors (pure, `unit-node`); `MessageTimestamp.test.tsx` asserts en + zh-CN output with a fixed `now` through `renderWithIntl`.

## Batch 6 — localized defaults (user-requested scope addition)

`DEFAULT_ASSISTANT_NAME` / `DEFAULT_TOPIC_TITLE` must localize. The topic title is also a sentinel ("has the title still not been generated?") compared in `title.service.ts` (guard + SQL compare-and-swap) and in the client `shouldRequestTopicTitle` — so stored values may be localized, and the sentinel checks must recognize every locale's default.

- Catalogs: `Chat.newTopic` ("New topic" / "新话题"), `Assistant.defaultName` ("Assistant" / "助手").
- New shared module `src/i18n/defaults.ts` (no hooks; importable from both server and client): the per-locale message map, `DEFAULT_TOPIC_TITLES` (every locale's `Chat.newTopic`), and `isDefaultTopicTitle(title)`.
- Creation localizes via service parameters (services stay transport-agnostic): the chat route resolves `t("Chat.newTopic")` and passes it to `createTopicForChat`; the assistant-tree route resolves `t("Assistant.defaultName")` and passes it into `listAssistantTree`.
- Sentinel checks accept any locale: `title.service` guard → `isDefaultTopicTitle`; CAS SQL → `inArray(topics.title, DEFAULT_TOPIC_TITLES)`; `shouldRequestTopicTitle` → `isDefaultTopicTitle`; `fallbackTitleFromMessage` takes a `defaultTitle` argument.
- Display fallbacks resolve from catalogs: `MessageItem` (`assistantName ?? …`), `ChatView` header (`… ?? topicTitle ?? t("Chat.newTopic")`).
- Remove `DEFAULT_TOPIC_TITLE` / `DEFAULT_ASSISTANT_NAME` from `src/lib/schemas/*` once unreferenced; tests assert via the helper or explicit per-locale values.
- Known limitation (accepted): the stored default is in the creator's locale; it is transient for topics (replaced by the generated title) and renameable for assistants.

## Risks

- `ChatView.tsx` is the largest file in the batch — copy-only edits, no behavior changes.
- `Markdown`/`citations` may embed labels (copy-code affordance, citation titles) — migrate only genuinely user-visible static copy.
- Tests already wrapped with `renderWithIntl` by `i18n-core`; assert catalog text, not duplicated strings. New provider needs = a test that renders a newly translated component without the wrapper (fix by wrapping).
- Do not touch `ui/*` primitives (already migrated) or the error contract.
