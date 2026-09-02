# Implementation Plan: Text Chat and Streaming

Ordered execution for `design.md`. Each stage ends in a state where
`pnpm lint && pnpm typecheck` pass, so a stage boundary is a safe stopping
point.

Read first: `prd.md` → `design.md` → `research/ai-sdk-v7-streaming-api.md`
(especially §8 "陷阱清单" and §9 code samples). The installed AI SDK generation
differs from the widely documented one; do not write `streamText` or `useChat`
code from memory.

---

## Stage 0 — Dependencies

- [ ] `pnpm add @ai-sdk/openai-compatible@3.0.41` — exact version (F18). A
      different major resolves `LanguageModelV3` and will not type-check
      against `ai@7.0.85`.
- [ ] `pnpm add streamdown` — do **not** add `@streamdown/code`, `@streamdown/cjk`,
      `@streamdown/math`, or `@streamdown/mermaid` (D9, Out of Scope).
- [ ] Verify with `pnpm typecheck` that nothing else in the lockfile moved.

Validation: `pnpm typecheck`

---

## Stage 1 — Schema and shared contracts

- [ ] `src/server/db/schema/chat.ts` — `chatMessageRole` / `chatMessageOutcome`
      enums plus the `chat_messages` table exactly as tabulated in
      `design.md` §2.1. Mirror `schema/provider.ts` for style; use the
      `timestamptz` helper from `./columns`; **no** `import "server-only"`
      (drizzle-kit loads schema files in a plain Node process —
      `backend/index.md:16-20`).
- [ ] Export it from `src/server/db/schema/index.ts`.
- [ ] `pnpm db:generate` — never hand-write the SQL
      (`backend/index.md:89-90`). Inspect the emitted file: it must contain two
      `CREATE TYPE`, one `CREATE TABLE`, one `CREATE INDEX`, and must not
      `ALTER` any existing table.
- [ ] `src/lib/schemas/chat.ts` — `ChatMetadata`, `ChatUIMessage`, the
      `POST /api/chat` request schema, the stop request schema, and the
      messages response schema. This file is imported by both server and
      client, so it must not pull in anything server-only.

Validation: `pnpm typecheck`, then `pnpm db:migrate` against an empty database.

Rollback point: nothing outside these files has changed yet.

---

## Stage 2 — Topic read path and ordering

- [ ] `topic.service.ts` — add `findTopicContextForActor` (design §2.3).
      Do **not** change `findTopicForActor`; three call sites rely on its
      narrow shape.
- [ ] `topic.service.ts` — add an internal helper to bump `topics.updatedAt`.
- [ ] `assistant.service.ts:116` — order topics by `desc(topics.updatedAt)`.
- [ ] Add `updatedAt` to the `Topic` Zod contract (`src/lib/schemas/topic.ts`)
      and to the tree selection in `selectTree` (`assistant.service.ts:100-104`).
- [ ] Update existing tests that assert topic ordering or the `Topic` shape.

Validation: `pnpm lint && pnpm typecheck && pnpm test`

---

## Stage 3 — Server services

- [ ] `src/server/services/message.service.ts` — `listTopicMessages`,
      `appendUserMessage`, `appendAssistantMessage`. Signatures are
      `(input, actor)` with no Next.js types
      (`backend/directory-structure.md:53`). Row ⇄ `ChatUIMessage` mapping
      lives here, including folding `outcome` / `error_message` /
      `provider_config_id` / `model_id` into `metadata` (design §3.3).
- [ ] `src/server/ai/chat-model.ts` — `buildChatModel` (design §4). The
      decrypted key must not escape the call frame; do not put it on an error
      or a log line.
- [ ] `src/server/ai/provider-error.ts` — `describeProviderError` (design §8),
      including key scrubbing and length clamping.
- [ ] `src/server/ai/stream-registry.ts` — the three functions in design §7.
- [ ] `src/server/services/title.service.ts` — design §5, with the truncation
      fallback and the "only while still `DEFAULT_TOPIC_TITLE`" guard checked
      again at write time.
- [ ] Vitest coverage for the pure logic: the row ⇄ `ChatUIMessage` mapping,
      `describeProviderError` (especially that a key embedded in an upstream
      body is scrubbed), the title post-processing and its fallback, and the
      registry's reject-foreign-user path. `backend/index.md:98` requires new
      service logic to have tests.

Validation: `pnpm lint && pnpm typecheck && pnpm test`

---

## Stage 4 — Chat endpoint

- [ ] `src/app/api/chat/route.ts` — the eight ordered steps in design §3.1,
      wrapped in `withErrorHandling`, then the stream assembly of design §6.
- [ ] `src/app/api/chat/stop/route.ts` — design §3.2. Foreign or unknown
      `streamId` is `NOT_FOUND`, not `FORBIDDEN` (`error-handling.md:72`).
- [ ] `src/app/api/topics/[id]/messages/route.ts` — design §3.3, following the
      params-unwrapping style already in `api/topics/[id]/route.ts:7-13`.

**Resolve design §12 items 1 and 2 here**, before building UI on top:

- Confirm the `data-topic` part reaches the client ahead of model output.
- Confirm `onEnd`'s `responseMessage` contains the partial `parts` when
  `isAborted` is true. If it does not, accumulate text via `streamText`'s
  `onChunk` and persist that instead — D4 ("keep the partial answer") is a
  product commitment, not an implementation detail to drop.

Validation: `pnpm lint && pnpm typecheck`, plus a manual `curl` against
`/api/chat` with a real provider config to see SSE frames arrive.

---

## Stage 5 — Remove the create-topic chain (D10 / R11)

- [ ] Delete `src/app/api/topics/route.ts`.
- [ ] Delete `createTopic` from `topic.service.ts:22-49`.
- [ ] Delete the `createTopic` fetcher from `src/lib/api/topic.ts`.
- [ ] Delete `useCreateTopic` from `use-assistants.ts:72-80`.
- [ ] Delete `createTopicSchema` / `CreateTopicInput` if nothing imports them.
- [ ] Keep `ownedAssistantIds` (`topic.service.ts:14-20`) — rename and delete
      still use it.

Do this **after** Stage 4 so topic creation is never absent from the codebase.

Validation: `pnpm lint && pnpm typecheck && pnpm test` — the tree must be free
of unused exports and dead imports.

---

## Stage 6 — Client data layer

- [ ] `src/lib/api/chat.ts` — fetchers parsed through the Stage 1 Zod schemas,
      following `src/lib/api/parse.ts:1-18`.
- [ ] `src/stores/composer-store.ts` — the project's first Zustand store (F9).
      One concern, narrow selectors, actions beside state
      (`state-management.md:49-65`). Holds draft text, picked
      `(configId, modelId)`, and the in-memory recent assistant (D3). No server
      data.
- [ ] `src/components/chat/use-chat-history.ts` — Query hook plus a
      `chatKeys` factory (`hook-guidelines.md:34-42`); never an inline key.

Validation: `pnpm lint && pnpm typecheck`

---

## Stage 7 — Chat UI

- [ ] Add the Streamdown `@source` directive to `src/app/globals.css` and
      **render a fenced code block to confirm it resolves through pnpm's
      symlink** (design §12 item 3). Symptom of failure: unstyled copy button
      and an invisible streaming caret.
- [ ] `MessageItem.tsx` — role styling, Streamdown for assistant text, visible
      badges for `stopped` and `failed`, with `error_message` shown on failed
      turns (D11).
- [ ] `MessageList.tsx`, `Composer.tsx` (send/stop toggle driven by `useChat`'s
      `status`), `ModelPicker.tsx` (R8, initial value derived per D5),
      `AssistantPicker.tsx` (only when the URL fixes no assistant).
- [ ] `ChatView.tsx` — `useChat` with a `DefaultChatTransport` and
      `prepareSendMessagesRequest` sending only the new message plus the ids
      (F16; top-level `api` / `body` fail silently). Stable chat `id` from
      `useState(() => topicId ?? newId())`. Stop calls the endpoint **and**
      `stop()`. On the `data-topic` part, store the topic id and
      `window.history.replaceState`. On finish, invalidate the assistant tree.
- [ ] Handle `error` and `status` explicitly — a stream can fail after tokens
      have rendered (`hook-guidelines.md:73-75`).

Validation: `pnpm lint && pnpm typecheck && pnpm test`

---

## Stage 8 — Route refactor (D8 / R10)

- [ ] Create `src/app/(app)/assistant/[assistantId]/page.tsx` and
      `.../[assistantId]/[topicId]/page.tsx` (design §9.1).
- [ ] Rewrite `src/app/(app)/page.tsx` as the no-assistant draft view.
- [ ] Delete `src/app/(app)/t/[topicId]/page.tsx`.
- [ ] `AssistantTree.tsx` — replace `useParams` with a `usePathname` parse
      (`:51-53`), drop the `pane` `useState` in favour of the URL (`:60-62`),
      change `href` to `/assistant/{assistantId}/{topicId}` (`:323`), point
      "New topic" at `/assistant/{assistantId}` with no mutation (`:80-91`),
      and fix the post-delete redirect (`:75`).
- [ ] `AssistantTree.test.tsx` — swap the `useParams` mocks
      (`:17,21,72,115,141`) for `usePathname`.
- [ ] Confirm design §12 item 4: `replaceState` keeps `usePathname` in sync, so
      the sidebar highlights the new topic without a remount.
- [ ] `rg -n "/t/" src` must return nothing.

Validation: `pnpm lint && pnpm typecheck && pnpm test`

---

## Stage 9 — Full verification

- [ ] Migrations apply cleanly from an **empty** database
      (`backend/index.md:104-105`).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` all green.
- [ ] Walk every box in the PRD's Acceptance Criteria by hand. The four that
      cannot be observed except manually: closing the tab mid-answer and
      finding it complete on return; stop leaving a marked partial; an invalid
      key producing a failed turn whose text contains no key fragment; and an
      abandoned "New topic" click leaving no row.
- [ ] Grep the diff for `any`, `!` non-null assertions, and unchecked `as`
      (`backend/index.md:99`).
- [ ] Confirm no log line carries message content or a key
      (`backend/index.md:91`).

---

## Risk register

| Risk | Signal | Response |
|---|---|---|
| `onEnd` yields no partial text on abort | Stopped turns persist empty | Accumulate via `onChunk` (Stage 4) |
| Streamdown `@source` fails through pnpm symlink | Unstyled code-block controls | Absolute path or `@source` on the `.pnpm` real path (Stage 7) |
| `replaceState` leaves `usePathname` stale | Sidebar does not highlight the new topic | Lift the active topic into `ChatView` state and pass down, at the cost of the D8 URL-state win |
| Router navigation sneaks in and remounts `ChatView` | Stream dies exactly when the URL changes | Keep the chat `id` stable; never `router.push` on first send |
| Title call slows the first token | Visible delay before streaming starts | It must not be awaited before `streamText` (design §5) |

## Rollback points

- Stages 0–3 touch no shipped behaviour; reverting is deleting new files plus
  the Stage 2 ordering change.
- Stage 5 is the first irreversible-feeling step (deletes shipped code); it is
  deliberately sequenced after the replacement path works.
- Stage 8 changes user-visible URLs; revert by restoring
  `t/[topicId]/page.tsx` and the `AssistantTree` diff together — they are one
  unit.
