# Migrate all UI screens to i18n

> Child of `09-10-i18n`. Depends on `i18n-core` (infrastructure + error contract + `.trellis/spec/frontend/i18n.md` must be merged and green). Do not start before that.

## Goal / deliverable

Every remaining user-facing screen renders entirely from message catalogs in `en` / `zh-CN`: auth/account, chat (including locale-aware timestamps), settings/admin/provider/search. No raw English remnants, tests updated.

## Batches (run in this order inside the task; commit per batch)

1. **auth + account** — `src/components/auth/` (SignInForm, SignUpForm, SetupForm, CredentialsForm, SignOutButton), `src/components/account/ChangePasswordForm.tsx`, `src/app/(auth)/**` pages/layouts with copy, `src/app/(app)/settings/account/page.tsx`. Namespaces `Auth`, `Account`.
2. **chat** — `src/components/chat/` (ChatView, Composer, MessageList, MessageItem, MessageActions, MessageTimestamp, ModelPicker, AssistantPicker, SearchModePicker, ComposerPickerContent, ComposerSelectTrigger, ToolCallShell, FetchToolCall, SearchToolCall, ReasoningBlock, ExternalLinkDialog, ChatMapDialog, CitationSup, Markdown if it carries copy, citations.ts if user-visible) and `src/components/topic/` dialogs (RenameTopicDialog, DeleteTopicDialog). Namespaces `Chat.*`, `Topic`.
3. **settings + admin + provider + search** — remaining `src/app/(app)/settings/**` pages (layout nav copy, providers, search, users), `src/components/admin/` (AdminUsersScreen, RegistrationToggle), `src/components/provider/` (ProviderConfigsScreen, ProviderConfigForm, ModelEditorDialog, DiscoverModelsSheet), `src/components/search/` (SearchProvidersScreen). Namespaces `Settings.*`, `Admin`, `Provider`, `Search`.
4. **timestamps (R6)** — per parent design §6: `src/lib/message-time.ts` becomes a locale-agnostic bucketing helper (`getMessageAge`), `MessageTimestamp.tsx` renders via `useTranslations` (ICU plurals) + `useFormatter().dateTime` with explicit `timeZone`; behavior thresholds unchanged. Namespace `Chat.Timestamp`.

## Rules

- Add `en` keys and `zh-CN` translations in the same commit as the component that uses them.
- Use only namespaces/key names fixed by parent design §3 and `.trellis/spec/frontend/i18n.md`; do not rename established keys.
- Error text is already key-based from `i18n-core`; do not introduce new hardcoded fallbacks — extend the `Errors` catalog instead.
- Proper nouns (model IDs, vendor names, native language labels) stay untranslated.
- Tests for migrated components render through `src/test-utils/render-with-intl.tsx`; add `zh-CN` cases for representative screens.

## Out of scope

- Streaming protocol internals, message persistence (no behavior change); LLM-generated content.
- New screens or copy rewrites — translation only.
- The ESLint regression guard (`i18n-guard` owns the final sweep).

## Acceptance criteria

- [ ] With `zh-CN`: every screen above shows Chinese (sign-in/up, setup, chat incl. composer/dialogs/tool-call labels, topics, settings, providers, search, admin, account); switching to `en` restores English without a reload.
- [ ] Relative timestamps follow the active locale with unchanged thresholds (parent AC6).
- [ ] Proper nouns unchanged in both locales.
- [ ] No hardcoded user-facing strings remain in the migrated files; no orphan catalog keys (every `en` key has a `zh-CN` counterpart within migrated scopes).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.
