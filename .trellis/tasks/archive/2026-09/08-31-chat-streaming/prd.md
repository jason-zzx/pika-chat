# Text Chat and Streaming

## Goal

A signed-in user types a message and watches the model answer token by token.
The server owns the transcript, so a reload, a second device, or a closed tab
all show the same conversation. This is the task that turns the four preceding
tasks — auth, shell, providers, assistants/topics — into a working product.

It owns the message data model, the streaming chat endpoint, the chat UI, and
the route refactor that makes conversations assistant-scoped. It is the last of
the five children of `08-31-mvp-phase1`.

## Background

### Source requirement

The only first-hand statement of scope is the phrase "文本聊天" in the original
project brief:

> 这个项目是一个用户自部署的AI聊天网站。首期功能将聚焦在**文本聊天**，需要实现PC端和移动端的
> 布局、配置供应商和模型、新建助手和话题、简单的用户管理等基础功能。

`TSD:9-11` restates phase-1 scope the same way. "Text chat" is the only phrase
covering this task, so every boundary in the Decisions section was settled with
the user during this planning session.

### Decided upstream — do not relitigate

`TSD` means
`archive/2026-08/00-bootstrap-guidelines/research/tech-stack-decision.md`.

| Constraint | Source |
|---|---|
| Every capability is an HTTP Route Handler; no Server-Action-only paths | `TSD:57`, `.trellis/spec/backend/index.md:52-57` |
| **Conversation state is server-authoritative**; the client is never the only holder of a message | `TSD:69-71`, `.trellis/spec/backend/index.md:58-59` |
| Auth accepts `Authorization: Bearer` as well as the session cookie | `.trellis/spec/backend/index.md:58` |
| Services take `(input, actor)` and never mention Next.js | `.trellis/spec/backend/directory-structure.md:53` |
| Ownership isolation is a `WHERE` clause; a row failing it is `NOT_FOUND`, never `FORBIDDEN` | `.trellis/spec/backend/database-guidelines.md:69`, `error-handling.md:72` |
| `text` UUIDv7 primary keys, `timestamptz`, `snake_case` plural tables, `pgEnum` over free text | `.trellis/spec/backend/database-guidelines.md:24-37` |
| Message table is pre-named `chat_messages`; chat endpoint pre-placed at `src/app/api/chat/route.ts` | `.trellis/spec/backend/directory-structure.md:17,112` |
| The assistant message is persisted **server-side in the stream's finish callback**, never from a client callback — the client may be gone | `.trellis/spec/backend/error-handling.md:115-116` |
| Once headers are sent the status cannot change; post-open failures travel **inside** the stream | `.trellis/spec/backend/error-handling.md:95-104` |
| A client disconnect is **not** a cancellation; the persisted answer must survive it. Explicit stop is a separate deliberate signal | `.trellis/spec/backend/error-handling.md:106-113` |
| `useChat` owns the in-flight turn; persisted history loads through a Query hook and seeds it | `.trellis/spec/frontend/hook-guidelines.md:62-80` |
| Transport stays configurable (a future React Native client injects `expo/fetch`) | `.trellis/spec/frontend/hook-guidelines.md:78-80`, `TSD:39-41` |
| Server state is TanStack Query, never mirrored into Zustand; composer draft and picked model are client state; derive before storing | `.trellis/spec/frontend/state-management.md:12-16,36` |
| Model availability comes from exactly one resolution function; chat must call it, not re-query | `TSD:116-119`, `database-guidelines.md:113` |
| Provider keys are decrypted only at the moment of the outbound call, never logged or returned | `.trellis/spec/backend/database-guidelines.md:122-133` |
| Resumable streams are an explicit **follow-on** — phase 1 only must not foreclose them | `TSD:44-47,93-94` |
| `components/ui/` is generated territory — wrap, never hand-edit | `.trellis/spec/frontend/directory-structure.md:52` |

### Confirmed facts — read from the repo, not recalled

**F1 — There is no message anything.** No `chat_messages` schema, service,
route, Zod contract, or `components/chat/`. Six migrations exist
(`0000`–`0005`); none touches message data. The string "messages" appears in
`src/` exactly once, in a placeholder sentence
(`src/app/(app)/t/[topicId]/page.tsx:30`).

**F2 — Zero AI SDK code exists.** `ai@7.0.85` and `@ai-sdk/react@4.0.88` are
installed (`package.json:19,22`) and never imported. No provider adapter
package is installed. `08-31-providers` deferred `@ai-sdk/openai-compatible`
and all inference here
(`archive/2026-09/08-31-providers/design.md:180-183`, `prd.md:12-13,215-217`).

**F3 — The two pages this task fills are contracted placeholders.**
`src/app/(app)/t/[topicId]/page.tsx:25-33` resolves the actor, calls
`findTopicForActor`, `notFound()`s on miss, renders `PageHeader` plus an
`EmptyState` reading "Messaging is not available yet".
`src/app/(app)/page.tsx:5-15` reads "Nothing to send yet / A provider must be
configured before chatting" — copy that is also factually wrong, since the real
precondition is a resolvable model (F7), not a provider row.
`08-31-app-shell` D-EMPTY-1 calls these "real work that `assistants-topics` and
`chat-streaming` will keep and feed data into".

**F4 — `findTopicForActor` does not return what chat needs.**
`src/server/services/topic.service.ts:86-102` selects only
`{ id, title, createdAt }`. It joins `assistants` purely for the ownership
filter and discards `assistantId`, `systemPrompt`, `defaultProviderConfigId`,
and `defaultModelId` — every field a chat request needs. This read path must
widen.

**F5 — Assistant carries the system prompt and default model, all nullable.**
`src/server/db/schema/assistant.ts:16-21`: `systemPrompt` nullable,
`defaultProviderConfigId` nullable (`set null` when the provider is deleted),
`defaultModelId` nullable with no FK. "This assistant has no usable model" is a
reachable state, not an edge case.

**F6 — `topics` cascades from `assistants`, which cascades from `users`.**
`src/server/db/schema/assistant.ts:34-36`, `:11-13`. A
`chat_messages.topic_id` cascade completes the chain — the missing link
`08-31-auth-users` cited when it deferred user deletion
(`archive/2026-08/08-31-auth-users/prd.md:279-281`).

**F7 — Model resolution ships and is a derived query, not a table.**
`src/server/ai/model-resolution.ts:10-45` returns
`AvailableModel[] = { configId, configName, modelId, provenance, ownerName }`
over own ∪ shared configs, exposed as `GET /api/models`
(`src/app/api/models/route.ts:5-8`). It returns no credentials; decryption is
`src/server/crypto.ts:8-40` and rows hold `baseUrl` + `encryptedApiKey`
(`src/server/db/schema/provider.ts:17-36`). `visibility` supports `shared`, so
one user can drive another's provider config.

**F8 — API conventions are uniform across 15 routes.** `withErrorHandling`
wraps every handler (`src/app/api/_lib/with-error-handling.ts:15-59`), errors
are `{ error: { code, message, details? } }`, Zod parses at the boundary,
services throw `AppError` (`src/server/errors.ts:3-11`). Client fetchers live in
`src/lib/api/` and parse through shared Zod schemas (`src/lib/api/parse.ts:1-18`).
`src/components/assistant/use-assistants.ts` is the working template for a
Query-hook + key-factory domain.

**F9 — `src/stores/` does not exist.** Zustand 5 is installed
(`package.json:39`) and unused. This task creates the first store.

**F10 — Auto-title has a prepared baseline.** `DEFAULT_TOPIC_TITLE = "New topic"`
is exported from `src/lib/schemas/topic.ts:3` and used at creation
(`topic.service.ts:33`), so "title still untouched" is detectable by comparison.

**F11 — Topic ordering is by creation, and `updated_at` means "last renamed".**
`selectTree` orders by `desc(topics.createdAt)`
(`src/server/services/assistant.service.ts:116`); the `Topic` contract exposes
only `{ id, title, createdAt }`. `topics.updated_at` exists
(`schema/assistant.ts:39`) but only rename touches it (`topic.service.ts:59`).

**F12 — The sidebar's "which assistant am I viewing" is `useState`.**
`AssistantTree.tsx:60-62` holds `pane` and derives
`pane === "list" ? undefined : (pane ?? topicAssistantId)`. Topic links are
`/t/${topic.id}` (`:323`) and the active id comes from
`useParams<{ topicId }>` (`:51-53`).

### Confirmed facts — the AI SDK generation actually installed

Full evidence in `research/ai-sdk-v7-streaming-api.md`, read from local `.d.ts`
files. The API differs sharply from the widely documented v3/v4 generation, so
these are requirements-level facts, not design detail.

**F13 — `toDataStreamResponse()` does not exist in `ai@7`**, and
`result.toUIMessageStreamResponse()` exists but is `@deprecated`. The current
form is `createUIMessageStreamResponse({ stream: toUIMessageStream({ ... }) })`.

**F14 — The persistence callback is `toUIMessageStream({ onEnd })`.** Only that
layer yields complete `UIMessage[]` with `parts` and server-assigned ids;
`streamText`'s callback yields `ModelMessage`-shaped data the frontend cannot
reconstruct. `onFinish` is renamed `onEnd` at both layers.

**F15 — Surviving a client disconnect requires `result.consumeStream()` and
forbids passing `req.signal` as `abortSignal`** — the two cancel each other
out. This is the mechanism behind the spec rule at `error-handling.md:106-113`.

**F16 — `useChat` no longer owns the input.** `input`, `handleInputChange`,
`handleSubmit`, `append`, `reload`, and `isLoading` are removed. It returns
`{ id, messages, status, error, sendMessage, regenerate, stop, clearError,
setMessages, ... }`. Initial history is the `messages` parameter (not
`initialMessages`). Extra request fields require a `DefaultChatTransport` with
`prepareSendMessagesRequest`; top-level `api` / `body` / `headers` do not exist
and fail silently.

**F17 — Storage shape should be `UIMessage` (a `parts` JSON array).**
`UIMessage → ModelMessage` is lossy and one-way, so plain text cannot
round-trip. Storing `UIMessage` feeds `useChat` directly and needs one
`await convertToModelMessages(...)` to feed `streamText`.

**F18 — `@ai-sdk/openai-compatible@3.0.41` is the matching version.** It pins
the same `@ai-sdk/provider@4.0.9` / `provider-utils@5.0.34` as `ai@7.0.85`;
`2.0.74` resolves `LanguageModelV3` and is type-incompatible. Streaming returns
no usage at all unless `includeUsage: true` is set.

**F19 — Custom data can be injected into the stream.**
`createUIMessageStream`'s `execute({ writer })` can write custom data parts
alongside model output (research §3.6(b), `ai/index.d.ts:5976-6003`), and
`generateMessageId` makes message ids server-authoritative (§3.6(a)).

## Decisions

**D1 — Scope is a core of four plus four deliberate additions.** Chosen over a
core-only variant and two thicker ones.

| Addition | Why it is not deferrable |
|---|---|
| Stop generation | Spec requires explicit cancellation to be a distinct signal (`error-handling.md:106-113`); an uninterruptible long answer is the most-felt defect |
| Markdown rendering | Model output *is* Markdown; raw text ships a visibly unfinished product |
| Composer model picker | F5 — both assistant default-model columns are nullable, so without a picker "no default model" is a dead end |
| Topic auto-title | F10 — otherwise every sidebar row reads "New topic" |

Deferred: regenerate, copy button, token-usage display, per-message
edit/delete, generation parameters.

**D2 — A topic row is created by sending the first message, never by clicking
"new topic".** The user's requirement: clicking 新建话题 must not insert a row;
the row appears only once something has been typed and sent.

This replaces shipped behaviour. `AssistantTree.onNewTopic`
(`AssistantTree.tsx:80-91`) currently awaits `useCreateTopic` then pushes to the
new topic. Under D2 both the sidebar's "New topic" and the home page lead to an
unsaved draft, and the send inserts the row.

Rationale beyond preference: an eagerly created row leaves an empty topic in the
sidebar for every abandoned click, and `08-31-assistants-topics` shipped no
reaper for them.

**D3 — The composer names a target assistant and lets the user switch it.**
Default target is the assistant of the most recently active topic; an explicit
switcher is present. Chosen over a read-only derived label and over always
using the seeded first assistant.

The most-recently-active assistant lives **in memory** (D8 gives the URL a
better job). Because it feeds the *default* of a client-side picker and never
becomes a second copy of server data, this does not breach
"server data is never mirrored into Zustand".

Sending must bump `topics.updatedAt` so "recently active" becomes true in the
data (F11 shows it currently means "last renamed"), and that column must reach
the tree contract and its ordering. **This changes shipped behaviour**: sidebar
topics will sort by recent activity rather than creation time, so an answered
topic rises to the top. Intentional, not a regression.

**D4 — Stop means the server really stops, and the partial answer is kept and
marked stopped.** Chosen over a client-only stop and over discarding the turn.

Two fixed constraints collide here: surviving a disconnect requires
`consumeStream()` and forbids `req.signal` as `abortSignal` (F15), while spec
requires explicit cancellation to be "a separate, deliberate signal — a
dedicated stop endpoint — not an inferred one" (`error-handling.md:106-113`).
Together they mean stopping cannot be expressed by closing the connection; it
needs an out-of-band channel that can abort a stream identified by id.

Known limitation, recorded rather than solved: an in-process registry of
in-flight streams is valid only for the single-process deployment this product
targets (`TSD:23-24`, "one process, one image"). Multi-replica cancellation
belongs with the deferred resumable-stream work, which needs a shared
active-stream store anyway.

Implied: an assistant message must carry how its turn ended — completed,
stopped, or failed.

**D5 — Each assistant message records the model that produced it, and the
composer's initial selection is derived from it.** Chosen over adding
`last_used_model` columns to `topics` and over not remembering at all.

Resolution order for the composer's initial value: the model on the topic's
last assistant message → the assistant's default pair (F5) → nothing
preselected. No new column on `topics`, satisfying "derive before storing"
(`state-management.md:36`). The recorded value is the `(configId, modelId)`
pair, not a bare model string — F7 shows model identity is unique only per
provider config.

**D6 — The title is generated from the user's own first message at send time,
by an LLM call, falling back to truncation on failure.** Specified by the user,
replacing an earlier "after the first answer completes" framing.

- Input is the user's first message, so the title does not wait for the answer.
- The call is a plain non-streaming completion issued in the same request as
  the stream and **not** serialised in front of it — blocking the first token
  on a sidebar label would trade away the task's headline feature.
- Any failure (provider error, timeout, empty or overlong output) falls back to
  truncating that same message. Titling never fails the turn.
- It uses the model the user picked, so no separate "utility model" setting
  appears in this task.
- It only applies while the title is still `DEFAULT_TOPIC_TITLE` (F10), so a
  manual rename is never overwritten.

**D7 — The server reports the new topic id and title over the stream itself.**
Implied by D2 + D6: at send time the client has neither, and both are produced
server-side mid-request. The mechanism is F19.

Two client-side consequences to design around: the URL must move to the topic's
address **without tearing down the streaming component** (a router navigation
remounts the subtree and drops in-flight `useChat` state), and the sidebar must
learn the real title rather than optimistically inserting a row the server may
have titled differently.

**D8 — The route hierarchy becomes assistant-scoped, using the word
*assistant*.** Specified by the user; the term was aligned to the codebase over
the initially proposed `/agent/`, since every table, service, component, and
type already says assistant (`assistants`, `AssistantTree`,
`assistant.service.ts`, `DEFAULT_ASSISTANT_NAME`).

| URL | Meaning |
|---|---|
| `/` | New conversation, no assistant chosen yet (falls back to the in-memory recent assistant) |
| `/assistant/{assistantId}` | New conversation targeted at one assistant |
| `/assistant/{assistantId}/{topicId}` | An existing conversation |

This is a refactor of shipped routes, not new-route work. Affected: the page at
`src/app/(app)/t/[topicId]/page.tsx`, and in `AssistantTree.tsx` the
`useParams` read (`:51-53`), the delete-time `router.push("/")` (`:75`), the
post-create push (`:87`), `activeTopicId` (`:131`), and the `href` (`:323`),
plus the `useParams` mocks in `AssistantTree.test.tsx:17,21,72,115,141`.

Positive side effect: F12's `pane` state becomes URL state, which is exactly
what `state-management.md:36-38` asks for.

**D9 — Markdown renders through Streamdown, without syntax highlighting.**

Verified rather than assumed: peer range is `react ^18 || ^19`; its components
assume the shadcn/ui design tokens this project already defines; it preprocesses
through `remend` to close unterminated bold/links/code fences mid-stream, which
is the specific reason raw `react-markdown` flickers while tokens arrive.

Tailwind 4 does not scan `node_modules`, so `src/app/globals.css` must gain an
`@source` directive for `streamdown/dist/*.js` or the code-block controls and
streaming caret render unstyled. Syntax highlighting is a separate
`@streamdown/code` plugin (Shiki); not installing it *is* the no-highlighting
decision. A `@streamdown/cjk` plugin exists for CJK typography and is not
adopted here, noted because this product's primary user writes Chinese.

Implementation risk to verify by rendering, not by reading config: pnpm links
`node_modules/streamdown` into `.pnpm/`, and the `@source` directive must be
able to follow that symlink from `src/app/globals.css`.

**D10 — The create-topic chain is deleted.** Under D2 it has no caller, and an
endpoint with no entry point is a liability. Removed:
`POST /api/topics` (`src/app/api/topics/route.ts`), `createTopic`
(`topic.service.ts:22-49`), the client fetcher in `src/lib/api/topic.ts`,
`useCreateTopic` (`use-assistants.ts:72-80`), and `createTopicSchema` if it
loses all consumers. Rename and delete keep their callers and stay.

The capability itself is not lost for a future mobile client — mobile also
creates topics by sending — so the Route-Handler-completeness constraint holds.

**D11 — Provider failures are persisted as a failed message and surfaced with
extracted upstream text, not the raw body.** The user asked for the upstream
original; this is the agreed middle ground.

Behaviour: the failed turn is persisted and rendered in the transcript in a
failed state, sharing D4's turn-outcome field, so a reload still shows which
turn failed. The message shown extracts the structured `error.message` /
`error.code` fields from the upstream payload, scrubs any occurrence of the
plaintext API key, and the full body goes to the server log.

Why not the raw body, despite the request: some OpenAI-compatible gateways echo
the request — including the `Authorization` header — inside the error body; F7's
`shared` visibility means user B can drive admin A's config, so raw text can
leak A's internal base URL, account, or quota state to B; and raw bodies are
unbounded and unstructured, which is a UI hazard on its own.

Why not spec's literal rule: `PROVIDER_ERROR: request failed` is useless for
self-hosted troubleshooting, while `model 'x' does not exist` names the fix
immediately.

**This deviates from `error-handling.md:81-87`, which forbids upstream error
bodies reaching the client.** Phase 3.3 must update that spec so code and spec
do not contradict each other.

## Requirements

- **R1 — Persist messages server-authoritatively.** A `chat_messages` table
  keyed to `topic_id` with cascade delete (F6), storing `UIMessage`-shaped
  parts (F17), written by the server: the user message on request, the
  assistant message in the stream's `onEnd` (F14), never from a client
  callback. Each assistant row records its `(configId, modelId)` pair (D5) and
  how the turn ended (D4, D11).
- **R2 — Stream a completion.** `POST /api/chat` resolves the actor, verifies
  topic ownership, builds an OpenAI-compatible model (F18) from a config
  reached through `resolveAvailableModels` (F7), and streams via
  `createUIMessageStreamResponse` (F13). The answer survives a client
  disconnect (F15).
- **R3 — Create the topic on first send.** With an assistant id and no topic
  id, the same request creates the topic, streams the answer, and reports the
  new id and title back over the stream (D2, D7). An abandoned draft leaves no
  row behind.
- **R4 — Load history.** Reopening a topic shows the persisted conversation,
  loaded through a Query hook that seeds `useChat`'s `messages` (F16).
- **R5 — Chat UI.** Message list plus composer, replacing the placeholders at
  `src/app/(app)/t/[topicId]/page.tsx:28-31` and `src/app/(app)/page.tsx:9-12`.
- **R6 — Stop generation.** A dedicated endpoint aborts the in-flight stream;
  the partial answer is persisted and marked stopped (D4).
- **R7 — Markdown rendering.** Assistant output renders as Markdown while
  streaming, via Streamdown, without syntax highlighting (D9).
- **R8 — Composer model picker.** The user picks among `resolveAvailableModels`
  results; the initial value is derived per D5.
- **R9 — Topic auto-title.** Titled from the user's first message by an LLM
  call at send time, falling back to truncation (D6). A manual rename is never
  overwritten.
- **R10 — Assistant-scoped routes.** The three URLs in D8, with the sidebar's
  viewing state driven by the URL.
- **R11 — Remove the create-topic chain.** Per D10, with no dead exports left
  behind.
- **R12 — Recent-activity ordering.** Sending bumps `topics.updatedAt`, and the
  assistant tree orders topics by it (D3).

## Acceptance Criteria

- [ ] From `/assistant/{id}`, typing and sending produces a streaming answer;
      the URL becomes `/assistant/{id}/{topicId}` without interrupting the
      stream, and a new topic appears in the sidebar.
- [ ] That topic's title is not `DEFAULT_TOPIC_TITLE`; when the titling call is
      made to fail, the title is a truncation of the first user message and the
      turn still succeeds.
- [ ] Clicking "New topic" and then navigating away creates **no** row: the
      sidebar topic count is unchanged and no `chat_messages` row exists.
- [ ] Reloading a topic shows the full transcript, user and assistant, in
      order, rendered as Markdown.
- [ ] Starting an answer, closing the tab, and reopening the topic shows the
      **complete** answer — the disconnect did not truncate persistence.
- [ ] Pressing stop ends generation server-side; the partial text is persisted,
      survives a reload, and is visibly marked as stopped.
- [ ] Switching the model in the composer sends the next turn to that model;
      reopening the topic preselects the model of the last assistant message.
- [ ] With a revoked or invalid API key, the failed turn appears in the
      transcript, survives a reload, shows the upstream `error.message`, and
      contains no fragment of the API key. The full body is in the server log.
- [ ] Deleting a topic removes its messages; deleting an assistant removes its
      topics and their messages.
- [ ] A user cannot read or post into another user's topic — the attempt is
      `NOT_FOUND`, not `FORBIDDEN`.
- [ ] Sidebar topics order by recent activity, and an answered topic moves to
      the top.
- [ ] `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass; migrations apply
      cleanly from an empty database.

## Out of Scope

- Resumable streams / `useChat({ resume: true })` and a shared active-stream
  store — explicit follow-on per `TSD:44-47,93-94`. Multi-replica stop
  cancellation rides along with it (D4).
- Regenerate, copy-to-clipboard, token-usage display, per-message edit/delete,
  generation parameters (temperature etc.) — deferred by D1.
- Syntax highlighting and CJK typography plugins for Streamdown (D9).
- Attachments and multimodal input — outside "文本聊天".
- A separate utility model for titling (D6).
