# Design: Text Chat and Streaming

Technical design for the requirements in `prd.md`. Decision references (`D1`…)
and fact references (`F1`…) point at that document; API-shape claims trace to
`research/ai-sdk-v7-streaming-api.md`.

---

## 1. Boundaries

| Layer | Adds |
|---|---|
| Data | `chat_messages` table + migration; `topics.updated_at` becomes meaningful |
| Domain | `message.service.ts`, `title.service.ts`, `src/server/ai/chat-model.ts`, `src/server/ai/stream-registry.ts`, widened topic read |
| Transport | `POST /api/chat`, `POST /api/chat/stop`, `GET /api/topics/[id]/messages`; delete `POST /api/topics` |
| Contracts | `src/lib/schemas/chat.ts` (shared `ChatUIMessage`, request/response Zod) |
| Client data | `src/lib/api/chat.ts`, `src/components/chat/use-chat-history.ts` |
| UI | `src/components/chat/**`, route move to `/assistant/**`, `AssistantTree` rewiring |
| Client state | `src/stores/composer-store.ts` (first store in the project, F9) |

Unchanged and reused as-is: `requireActor` / `resolveActor`
(`src/server/auth/actor.ts:29-60`), `withErrorHandling`
(`src/app/api/_lib/with-error-handling.ts:15-59`), `AppError`
(`src/server/errors.ts:13-23`), `resolveAvailableModels`
(`src/server/ai/model-resolution.ts:10-45`), `decryptSecret`
(`src/server/crypto.ts:42-68`), `newId` (`src/lib/id.ts`), `logger`.

---

## 2. Data model

### 2.1 `chat_messages`

New file `src/server/db/schema/chat.ts`, following the shape of
`schema/provider.ts` (pgEnum at top, `timestamptz` helper from `./columns`,
index array as the third `pgTable` argument), exported from `schema/index.ts`.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | UUIDv7 via `newId()`, server-generated (F19 `generateMessageId`) |
| `topic_id` | `text` NOT NULL → `topics.id` `ON DELETE CASCADE` | Completes the users → assistants → topics → messages chain (F6) |
| `role` | `pgEnum chat_message_role` (`user`, `assistant`) | Enum over free text per `database-guidelines.md:24` |
| `parts` | `jsonb` NOT NULL | The `UIMessage.parts` array (F17) |
| `outcome` | `pgEnum chat_message_outcome` (`completed`, `stopped`, `failed`) nullable | Assistant rows only; `NULL` for user rows (D4, D11) |
| `error_message` | `text` nullable | The sanitised upstream text for `failed` rows (D11) |
| `provider_config_id` | `text` nullable → `provider_configs.id` `ON DELETE SET NULL` | Half of the model pair (D5) |
| `model_id` | `text` nullable | Other half; no FK, matching how `assistants.default_model_id` is stored (F5) |
| `created_at` | `timestamptz` NOT NULL DEFAULT now() | |

Index: `chat_messages_topic_created_idx` on `(topic_id, created_at)`.

`SET NULL` rather than cascade on `provider_config_id`: deleting a provider
config must never delete conversation history. A null pair degrades the D5
derivation to the next fallback, which is the intended behaviour.

Ordering uses `(created_at, id)`. UUIDv7 is time-sortable, so the id is a
deterministic tie-break within the same millisecond.

### 2.2 Why `outcome` is nullable rather than defaulted

A user row has no outcome. Defaulting it to `completed` would make
"assistant turn that finished" indistinguishable from "user message" in
aggregate queries, so the column stays `NULL` for user rows and every read that
cares filters on `role = 'assistant'`.

### 2.3 Widening the topic read (F4)

`findTopicForActor` returns `{ id, title, createdAt }` and drops everything the
chat request needs. Rather than widening it in place — three call sites depend
on the narrow shape — add a sibling in `topic.service.ts`:

```ts
export async function findTopicContextForActor(
  id: string,
  actor: Actor,
): Promise<TopicContext | null>
```

returning `{ topic: { id, title }, assistant: { id, systemPrompt,
defaultProviderConfigId, defaultModelId } }` from the same
`topics ⋈ assistants` join, keeping the `assistants.owner_id = actor.userId`
ownership filter that makes a foreign topic `NOT_FOUND`.

### 2.4 `topics.updated_at` and ordering (D3, R12)

Sending bumps `topics.updatedAt`. `selectTree` changes its topic ordering from
`desc(topics.createdAt)` to `desc(topics.updatedAt)`
(`assistant.service.ts:116`), and `updatedAt` joins the `Topic` Zod contract so
the client can order consistently.

---

## 3. Server contracts

### 3.1 `POST /api/chat`

Request (Zod-parsed at the boundary per F8):

```ts
{
  assistantId: string;          // always present
  topicId?: string;             // absent on the first send of a draft (D2)
  providerConfigId: string;     // the (configId, modelId) pair (D5)
  modelId: string;
  message: ChatUIMessage;       // ONLY the new user message
}
```

The client sends one message, not the whole array. History is read from the
database, which is what "server-authoritative" means in practice
(`backend/index.md:58-59`): a tampered client cannot rewrite its own past. This
requires `prepareSendMessagesRequest` on the transport (F16), because `useChat`
posts the full array by default.

Execution order:

1. `requireActor(request.headers)`.
2. Parse with Zod.
3. Resolve the pair against `resolveAvailableModels(actor)` (F7). A pair not in
   the list is `VALIDATION_FAILED` — this is also the send-time
   "model no longer available" check that `08-31-assistants-topics` deferred
   here.
4. Resolve the topic:
   - `topicId` present → `findTopicContextForActor`; `null` → `NOT_FOUND`.
   - absent → `requireOwnedAssistant(assistantId, actor)`, then insert a topic
     with `DEFAULT_TOPIC_TITLE` (D2). This is the only remaining topic-insert
     path after D10.
5. Load history via `listTopicMessages` (empty for a fresh topic).
6. Insert the user message row and bump `topics.updatedAt`.
7. Kick off titling **without awaiting** when the title is still
   `DEFAULT_TOPIC_TITLE` (D6, §5).
8. Build the model (§4), call `streamText`, return the stream (§6).

Steps 3–6 run before any streaming byte, so their failures are ordinary JSON
errors with real status codes. Everything after the first byte must travel
inside the stream (`error-handling.md:95-104`).

### 3.2 `POST /api/chat/stop`

`{ streamId: string }` → `204`. Looks the id up in the in-process registry
(§7), verifies the entry's `userId` matches the actor, and aborts. An unknown
or foreign id is `NOT_FOUND` — never leak whether someone else's stream exists
(`error-handling.md:72`).

### 3.3 `GET /api/topics/[id]/messages`

Returns `{ messages: ChatUIMessage[] }` ordered by `(created_at, id)`, scoped
by the same ownership join. Rows are rebuilt into `UIMessage` shape: `parts`
comes back verbatim, while `outcome`, `error_message`, `provider_config_id`,
and `model_id` are assembled into `metadata` so the client can render a stopped
or failed turn and derive the model pick (D5).

Placed under the existing `api/topics/[id]/` directory next to the shipped
`PATCH` / `DELETE` handlers.

### 3.4 Deletions (D10, R11)

Remove `src/app/api/topics/route.ts`, `createTopic`
(`topic.service.ts:22-49`), the `createTopic` fetcher in `src/lib/api/topic.ts`,
`useCreateTopic` (`use-assistants.ts:72-80`), and `createTopicSchema` /
`CreateTopicInput` once no consumer remains. `ownedAssistantIds`
(`topic.service.ts:14-20`) stays — rename and delete still use it.

---

## 4. Model construction

New `src/server/ai/chat-model.ts`:

```ts
export async function buildChatModel(
  pair: { providerConfigId: string; modelId: string },
  actor: Actor,
): Promise<LanguageModel>
```

Reads the config row, `decryptSecret(encryptedApiKey)`
(`crypto.ts:42-68`), and returns
`createOpenAICompatible({ name, baseURL, apiKey, includeUsage: true })(modelId)`.

- `@ai-sdk/openai-compatible@3.0.41` pinned exactly (F18); a wrong major
  resolves `LanguageModelV3` and fails to type-check.
- **`baseUrl` is stored *including* the `/v1` segment** and is passed through
  untouched — no stripping, no appending. Verified in three places:
  `08-31-providers/design.md:164-166` states base URLs are stored with `/v1`
  "matching what `createOpenAICompatible({ baseURL })` wants in the chat task";
  the form placeholder is `https://api.openai.com/v1`
  (`src/components/provider/ProviderConfigForm.tsx:81`); and
  `discovery.ts:32` builds `${baseUrl}/models`, which only reaches the
  OpenAI-compatible `/v1/models` endpoint if `/v1` is already present.
  Getting this wrong yields a 404 that looks exactly like "model not found"
  (research §6.3, pitfall 15).
- The plaintext key exists only inside this call frame. It is never returned,
  logged, or attached to an error (`database-guidelines.md:122-133`).
- `includeUsage: true` because streaming otherwise reports no usage at all
  (F18). Usage is not displayed in this task (D1), but the metadata channel is
  wired so the deferred feature does not need a migration.

---

## 5. Titling (D6, R9)

New `src/server/services/title.service.ts`:

```ts
export async function titleTopicFromFirstMessage(
  args: { topicId: string; text: string; model: LanguageModel },
): Promise<void>
```

- Runs only while the stored title equals `DEFAULT_TOPIC_TITLE` (F10), checked
  again at write time so a concurrent manual rename wins.
- Non-streaming `generateText` with a short instruction, low token cap, on the
  model the user picked (D6 — no separate utility model).
- Post-processing: trim, strip surrounding quotes, collapse newlines, clamp
  length. An empty or over-long result counts as failure.
- Any failure falls back to truncating the same first message. The function
  never throws into the request path; failures are logged and swallowed.
- Started before the stream (step 7) and awaited inside `onEnd` (§6) so the row
  is titled before the client is told the turn is over. Since it has been
  running alongside the whole answer, the await is normally already resolved.

---

## 6. The stream (R2, D7)

`createUIMessageStream` with an `execute({ writer })` (F19) rather than the bare
`toUIMessageStream`, because a custom data part has to reach the client:

```
writer.write({ type: "data-topic", data: { topicId, streamId } })   // first
writer.merge(toUIMessageStream({ stream: result.stream, ... }))
```

Then `createUIMessageStreamResponse({ stream })`. Notes that come straight from
the installed types:

- `toDataStreamResponse` does not exist and `toUIMessageStreamResponse` is
  deprecated (F13).
- `originalMessages` must be passed or persistence mode is not entered (F14).
- `generateMessageId` makes the assistant id server-authoritative.
- `messageMetadata` is where `(configId, modelId)` and usage are attached.
- When merging, `sendStart: false` avoids a duplicate `start` chunk.
- **`abortSignal` is the registry's controller signal, never `req.signal`**
  (F15) — with `void result.consumeStream()` (not awaited) to drain backpressure
  so a disconnected client does not stall the generation.

`onEnd({ responseMessage, outcome, isAborted })` performs the single write of
the assistant row:

| Condition | `outcome` column | Extra |
|---|---|---|
| `isAborted` | `stopped` | Partial `parts` persisted as received (D4) |
| `outcome.status === "failed"` | `failed` | `error_message` = sanitised text (§8) |
| otherwise | `completed` | |

Then it awaits the title promise, bumps `topics.updatedAt`, and releases the
registry entry in a `finally`.

Unlike the research sample, a failed turn **is** persisted (D11) rather than
skipped.

`onError` returns the sanitised user-facing string, which is how a
post-headers failure reaches the UI as a stream event instead of a truncated
response (`error-handling.md:95-104`).

---

## 7. Stop mechanism (R6, D4)

New `src/server/ai/stream-registry.ts` — a module-level `Map<string, { controller: AbortController; userId: string }>`:

```ts
export function registerStream(streamId: string, userId: string): AbortSignal
export function abortStream(streamId: string, userId: string): boolean
export function releaseStream(streamId: string): void
```

`streamId` is a `newId()` minted at the start of the request and pushed to the
client in the first data part (§6), so the client can call
`POST /api/chat/stop` with it. The registry entry is released in `onEnd`'s
`finally`, including on abort, so the map cannot grow unbounded.

Why a registry at all: F15 forbids using `req.signal`, so the cancel signal
cannot ride the original connection; spec forbids inferring cancellation from a
disconnect. A second request carrying a stream id is the only remaining channel.

Bounded by design (D4): a module-level map is process-local and correct only for
the single-process deployment this product targets (`TSD:23-24`). Written down
in `prd.md` as a known limitation belonging to the deferred resumable-stream
work.

Client side, `useChat`'s own `stop()` only halts local rendering, so the UI
calls the endpoint **and** `stop()`.

---

## 8. Error classification and sanitisation (D11)

New `src/server/ai/provider-error.ts`:

```ts
export function describeProviderError(error: unknown, apiKey: string): {
  code: AppErrorCode;
  message: string;
}
```

1. Recognise the SDK's `APICallError` and read its status.
2. Extract only the structured `error.message` / `error.code` fields from the
   upstream payload — never the raw body (D11).
3. Scrub: remove any occurrence of the plaintext key, and clamp to a sane
   length.
4. Map status to code: `401/403` → `PROVIDER_ERROR` ("credentials rejected"),
   `404` → `PROVIDER_ERROR` (model missing), `429` → `RATE_LIMITED`, `5xx` /
   timeout / network → `PROVIDER_ERROR`.
5. Log the full body with `logger.error` — that is the only place it exists.

Used in two places: `onError` (post-headers, into the stream) and the
pre-stream steps (ordinary JSON error). Same function, so the two paths cannot
describe the same failure differently.

---

## 9. Frontend

### 9.1 Routes (D8, R10)

| New file | Renders |
|---|---|
| `src/app/(app)/assistant/[assistantId]/page.tsx` | RSC: assistant ownership check → `<ChatView assistantId />` (draft) |
| `src/app/(app)/assistant/[assistantId]/[topicId]/page.tsx` | RSC: `findTopicContextForActor` → `<ChatView assistantId topicId />` |
| `src/app/(app)/page.tsx` (rewrite) | RSC → `<ChatView />`; the assistant comes from the in-memory recent value (D3) |

`src/app/(app)/t/[topicId]/page.tsx` is deleted. The RSC layer keeps doing what
it does today — resolve the actor, verify ownership, `notFound()` on miss — and
hands identity down as props, matching the shell's pattern.

### 9.2 Components

```
components/chat/
  ChatView.tsx          client; owns useChat + transport
  MessageList.tsx       renders messages, scroll-to-bottom
  MessageItem.tsx       role styling, Streamdown, stopped/failed badge
  Composer.tsx          textarea + send/stop
  ModelPicker.tsx       resolveAvailableModels list (R8)
  AssistantPicker.tsx   only shown when no assistant is fixed by the URL (D3)
  use-chat-history.ts   Query hook for GET messages
```

### 9.3 Two hard parts

**The chat instance must outlive the URL change.** After the first send the
address becomes `/assistant/{aid}/{tid}`, but a router navigation remounts the
subtree and drops in-flight `useChat` state (D7). So:

- `useChat({ id })` is seeded once with `useState(() => topicId ?? newId())` and
  never changes for the life of the component.
- The topic id arriving in the `data-topic` part is stored in component state
  and used for subsequent requests.
- The address is updated with `window.history.replaceState`, which Next.js
  integrates into its router without remounting.

**The sidebar must still highlight the active topic.** `AssistantTree` reads
`useParams<{ topicId }>` (`F12`, `:51-53`), and `replaceState` does not
re-match route segments, so `useParams` would go stale. It switches to parsing
`usePathname()`, which Next.js does keep in sync with `replaceState`. The same
parse yields the active assistant, which replaces the `pane` `useState`
(`:60-62`) — the URL-state win noted in D8.

### 9.4 State ownership (`state-management.md:12-16`)

| State | Home |
|---|---|
| Persisted messages | TanStack Query (`use-chat-history`) |
| In-flight turn | `useChat` |
| Available models | TanStack Query (existing `GET /api/models`) |
| Draft text, picked model, recent assistant | Zustand `composer-store` (F9) |
| Active topic / assistant | URL |
| Textarea focus, menu open | `useState` |

The picked model is client state whose *initial value* is derived from server
data (D5); the derivation runs on load rather than copying the list into the
store, so the "never mirror server data" rule holds.

### 9.5 Seeding and invalidation

`use-chat-history` fetches persisted messages and passes them as `useChat`'s
`messages` (F16 — not `initialMessages`). On stream finish, the assistant-tree
query is invalidated so the new topic and its real title appear; because `onEnd`
awaits titling (§5), that refetch cannot race the title write.

---

## 10. Compatibility and migration

- One additive migration via `pnpm db:generate` (never hand-written,
  `backend/index.md:89-90`): two enums, one table, one index. No existing table
  is altered; `topics.updated_at` already exists and only changes meaning.
- Rollback is `DROP TABLE chat_messages` plus the two enums. Nothing else in
  the schema references it.
- The route move changes user-visible URLs. Existing `/t/{id}` links are
  bookmarks at most (the product is unreleased), so no redirect shim is added —
  worth stating explicitly rather than leaving as an oversight.
- `AssistantTree.test.tsx` mocks `useParams`; it must move to mocking
  `usePathname` in step with §9.3.

## 11. Trade-offs taken

**One `chat_messages` table, no `conversations` table.** `topics` already is the
conversation. A separate table would duplicate it.

**`parts` as `jsonb`, not normalised parts rows.** F17 — the SDK's own unit is
the message with its parts array; normalising would force reassembly on every
read for no query benefit this product needs.

**Titling shares the user's chosen model.** Simpler and no new setting (D6); the
cost is that an expensive model also pays for a title. Acceptable while a
utility-model setting stays out of scope.

**The stop registry is process-local.** Accepted per D4; the alternative is the
shared active-stream store that belongs to the deferred resumable-stream work.

## 12. To verify during implementation, not assumed

1. Whether `writer.merge` before `await`-ing other work orders the data part
   ahead of model output as intended (§6).
2. That `isAborted` in `onEnd` carries the partial `parts` — the whole of D4's
   "keep the partial answer" depends on it. `onAbort` alone is documented to
   expose only completed steps, with no text (research §2.5), so if `onEnd`
   proves empty on abort the fallback is accumulating text via `onChunk`.
3. That the Tailwind 4 `@source` directive resolves Streamdown through pnpm's
   symlink (D9) — check by rendering a code block, not by reading config.
4. That `window.history.replaceState` keeps `usePathname` in sync in Next.js 16
   App Router well enough for §9.3.
