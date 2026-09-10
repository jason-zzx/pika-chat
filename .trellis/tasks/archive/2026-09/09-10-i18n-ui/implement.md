# Implement plan — i18n-ui

Read order: `prd.md` → `design.md` (this dir) → parent `../09-10-i18n/design.md` → `.trellis/spec/frontend/i18n.md` → `../09-10-i18n/research/next-intl-usage.md`.

**No git commits** — leave every change in the working tree; the main session commits per batch in Phase 3.4. Run the gate after each batch.

## Batch 1 — auth + account

1. Sweep hardcoded user-facing strings in: `components/auth/*`, `components/account/ChangePasswordForm.tsx`, `app/(auth)/{layout,setup/page,sign-in/page,sign-up/page}.tsx`, `app/(app)/settings/account/page.tsx`, `lib/auth-client.ts` (`SIGN_IN_FAILED_MESSAGE`).
2. Add `Auth` / `Account` entries to both catalogs; migrate components with `useTranslations("Auth"|"Account")` (async server pages: `getTranslations`).
3. `SIGN_IN_FAILED_MESSAGE` becomes key-based; update its consumer(s).
4. Update touched tests to `renderWithIntl` (assert catalog text, not duplicated strings).
5. Gate: `pnpm lint && pnpm typecheck && pnpm test`.

## Batch 2 — chat (+ topic dialogs)

6. Sweep `components/chat/*` user-facing files, including the core-task leftovers: `ChatView.tsx` ("The message is still being saved…"), `MessageItem.tsx` stream-failure chrome ("Thinking…", "The model failed to respond.", etc.), plus Composer, MessageList, MessageActions, ModelPicker, AssistantPicker, SearchModePicker, ComposerPickerContent, ComposerSelectTrigger, ToolCallShell, FetchToolCall, SearchToolCall, ReasoningBlock, ExternalLinkDialog, ChatMapDialog, CitationSup, Markdown/citations if user-visible; and `components/topic/{RenameTopicDialog,DeleteTopicDialog}.tsx`.
7. Add `Chat.*` / `Topic` entries to both catalogs; migrate. Copy-only — no behavior or protocol changes.
8. Update chat tests (wrap with `renderWithIntl` where missing): MessageItem(+citations), MessageList, Composer, MessageActions, ModelPicker, ChatView, ExternalLinkDialog, CitationSup, ReasoningBlock, SearchToolCall, FetchToolCall, ChatMapDialog, Markdown variants.
9. Gate: same as batch 1.

## Batch 3 — settings + admin + provider + search

10. Sweep remaining `app/(app)/settings/**` pages, `components/admin/*`, `components/provider/*` (incl. `ModelEditorDialog.tsx` client-side validation strings), `components/search/SearchProvidersScreen.tsx`.
11. Add `Settings.*` / `Admin` / `Provider` / `Search` entries to both catalogs; migrate.
12. Update tests (ProviderConfigsScreen, SearchProvidersScreen; AdminUsersScreen/SettingsNav if touched).
13. Gate: same as batch 1.

## Batch 4 — timestamps (R6)

14. `lib/message-time.ts`: keep `parseTimestamp`; replace `formatMessageAge`/`formatMessageExact` with the pure descriptor `getMessageAge(iso, now)` per `design.md` (thresholds unchanged).
15. `MessageTimestamp.tsx`: `useNow({ updateInterval: 30_000 })`; label from `useTranslations("Chat.Timestamp")`; date via `useFormatter().dateTime` and tooltip via `format.dateTime` — both with explicit `timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone`.
16. Update `message-time.test.ts` (descriptor assertions) and `MessageTimestamp.test.tsx` (en + zh-CN, fixed `now` via `renderWithIntl`).
17. Gate: same as batch 1.

## Final

18. Repo-wide check within scope: no hardcoded JSX copy remains (grep sweep); `messages/en.json` vs `zh-CN.json` key parity; `pnpm build` sanity.
19. Report per-batch file lists (the main session needs them for the 4 batch commits), commands run with results, and any deviations/leftovers.

## Batch 6 — localized defaults (user-requested scope addition; follow design.md §Batch 6)

20. Add catalog keys to both locales: `Chat.newTopic` ("New topic" / "新话题"), `Assistant.defaultName` ("Assistant" / "助手").
21. Create `src/i18n/defaults.ts`: per-locale message map, `DEFAULT_TOPIC_TITLES`, `isDefaultTopicTitle(title)`. No hooks — importable from server and client.
22. Creation paths: resolve the localized default at the transport boundary and pass it in — chat route → `createTopicForChat(input, actor, defaultTitle)`; assistant tree route → `listAssistantTree(actor, defaultName)` (keep services transport-agnostic; `getTranslations` only in routes).
23. Sentinel checks: `title.service.ts` guard → `isDefaultTopicTitle`; CAS SQL → `inArray(topics.title, DEFAULT_TOPIC_TITLES)`; `fallbackTitleFromMessage(text, defaultTitle)`; client `shouldRequestTopicTitle` → `isDefaultTopicTitle`.
24. Display fallbacks: `MessageItem.tsx` (`assistantName ?? t("defaultName")` under the Assistant namespace) and `ChatView.tsx` header (`?? topicTitle ?? t("newTopic")`).
25. Remove `DEFAULT_TOPIC_TITLE` / `DEFAULT_ASSISTANT_NAME` from `src/lib/schemas/*` once unreferenced; update tests (`title.service.test.ts`, `topic.service.integration.test.ts`, `assistant.service.integration.test.ts`, `should-request-topic-title.test.ts`) and add a focused `src/i18n/defaults.test.ts` (both locale values recognized; a renamed title is not).
26. Gate: `pnpm lint && pnpm typecheck && pnpm test`; report the batch-6 file list. No commits.

## Risky files

- `ChatView.tsx` — largest file; copy-only edits.
- `MessageItem.tsx` — streaming states; do not alter streaming behavior.
- `MessageTimestamp.tsx` + `message-time.ts` — behavior-preserving refactor; thresholds must not change.
- `components/provider/*` forms — client validation strings move to catalogs; keep validation logic identical.
