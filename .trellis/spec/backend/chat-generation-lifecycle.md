# Server-Managed Chat Generation

## 1. Scope / Trigger

Applies to send, regenerate, edit-and-regenerate, image turns, stream resume,
stop/delete, and process startup/shutdown. The server process owns inference;
HTTP responses are subscribers. One application instance, PostgreSQL, no Redis
or separate worker. Different topics run independently; no global/actor cap.

Primary owners:
- `services/generation.service.ts`: admission, receipts, durable transitions.
- `ai/generation-runner.ts`: scheduling, subscriptions, checkpoints, finalization.
- `ai/generation-stream.ts`: one authoritative `applyChunk` accumulator and
  current-state prefix encoding (not a historical chunk log).
- `ai/generation-registry.ts`: process-wide live entries/subscribers.
- `ai/generation-turn.ts`, `ai/image/turn.ts`: model execution and side effects.
- `src/app/api/chat/_lib/`: preflight and HTTP response (authorization on connect).

## 2. Signatures

| Boundary | Contract |
|---|---|
| `POST /api/chat` | Existing body + optional UUIDv7 `requestId`; 200 UIMessage SSE, `data-topic`, `x-pika-generation-id` |
| `POST /api/topics/[id]/messages/[messageId]/regenerate` | Existing body/edit + optional `requestId`; 200 SSE, no `data-topic`; `x-pika-stream-id` and `x-pika-generation-id` identify the generation |
| `GET /api/chat/generations?active=true` | `{ generations: GenerationSummary[] }`, current account only, no message body |
| `GET /api/chat/generations?requestId=...` | `{ generation: GenerationSummary }`; mutually exclusive query mode |
| `GET /api/chat/generations/[id]/stream` | Active: current-state prefix + live chunks. Terminal: 204, refetch history. Deleted target: 410 |
| `POST /api/chat/stop` | Existing `{ streamId }`; value is the durable generation ID, not an HTTP connection |
| `subscribeToGeneration(entry): ReadableStream<ChatChunk>` | Current-state prefix + live chunks; stream/reader cancellation detaches only this subscriber |
| `startGenerationRunner(): Promise<void>` | Shared boot/recovery, then queued work; normal admission dispatches immediately |
| `stopGenerationRunner(): Promise<void>` | Explicit runner stop used by tests; shared promise, abort and await live/starting work within one deadline. Not wired to process signals |
| `admitTurn(input, prepare, actor, { clock? })` | Sole exported admission entry; receipt/window check then authorized preparation and private transactional acceptance |

`GenerationSummary` lives in `src/lib/schemas/generation.ts` and includes ID,
nullable topic/assistant/message associations, kind/status, target-deleted flag,
error, and timestamps. Routes use `requireActor`/`requireParam`; all task reads
filter `userId`.

DB: migration `0025_steady_sway.sql`, `chat_generations` in
`src/server/db/schema/chat.ts`. Statuses: `queued`, `running`, `stopping`,
`completed`, `stopped`, `failed`, `interrupted`. Unique request receipt per
`(user_id, request_id)` and one active generation per topic (partial unique
index for queued/running/stopping). `chat_messages` gains nullable
`total_tokens`/`finish_reason`; existing outcome enum is unchanged.

## 3. Contracts

### Admission and context

- Look up an existing receipt **before** mutable model/attachment/quota
  preflight. Same input follows the existing task without invoking the model;
  a different input conflicts. Missing IDs retain legacy POST behavior.
  `admitTurn` performs the lock-free receipt/window checks once and passes the
  computed expiry to private `acceptTurn`. Keep the receipt recheck under an
  existing-topic lock and the unique-conflict winner lookup for concurrent
  fresh-topic requests; these are not redundant preflight.
- New UUIDv7 keys are accepted from DB now minus 24h through plus 5min.
  Existing active receipts remain valid regardless of age. Terminal cleanup
  waits until both `finishedAt + 24h` and key expiry have passed; an expired
  key cannot recreate a task after receipt deletion. Target deletion retains
  only a minimal tombstone until expiry.
- Preflight has no business writes. Admission locks the topic, checks the
  prepared history/summary still matches, and atomically writes the user/edit,
  assistant placeholder and task. Stable message/group IDs exist before SSE.
  Frozen input includes history IDs, prompt, summary, locale and timezone;
  background execution must not read request-scoped cookies/translations.
- `prepareSendTurn` / `prepareRegenerateTurn` establish assistant/topic ownership
  for admission. Shared message-service entry points (`appendUserMessage`,
  `appendUserMessageVersion`, `appendAssistantMessage`, `insertAssistantPlaceholder`)
  still authorize independently, including calls supplied with `tx`. They and
  authorized admission reuse `insertUserMessageRow`, `insertUserMessageVersionRow`
  and `insertAssistantRow`; routes must not call those lower-level writers.
  Passing a transaction is not proof of authorization; no `skipAuth` flag.
  Both Drizzle DB and transaction executors support `.transaction()` (a nested
  call uses a savepoint); do not detect the method or add a fallback path.
- `runGenerationTurn` resolves the model once per execution and passes the
  result to `runTextTurn`. Preparation and execution retain separate boundary
  resolutions; this is not a cache or a bypass of model access checks.
- An edited user message appears once in model context, replacing its prior
  selected version; the assistant placeholder is never context.
- While a topic is active, new generation, delete-message, version selection,
  and manual compression return 409. Title/favorite updates remain available.
  Automatic compression uses the task's frozen prefix, not the manual
  compression entry point that would reject its own active task.

### Current state, persistence and cancellation

- Registry/runner survive separately evaluated Next bundles and dev HMR via
  process-wide state. Conditional queued-to-running claim plus shared in-flight
  claim promises prevents duplicate execution.
- `applyChunk` updates one current message, active part IDs and raw unfinished
  tool input. Publish live deltas, not repeated full answers. Capture the
  recovery prefix and attach its subscriber synchronously, with no `await`
  between them. Text/reasoning/tool IDs must match subsequent live chunks.
- Accept and terminal transitions persist. A dirty current state is checkpointed
  every 10s for **crash retention**, never as the live resume source. At most
  one checkpoint write per task; consumption does not await it. A failed
  checkpoint does not cancel inference.
- Finalization stops the checkpoint timer, waits for an in-flight checkpoint,
  then writes message and task outcome in one transaction. Only after the
  durable decision publish finish/abort/error and release live state.
- Terminal DB failure retains final content and image references and retries
  **only persistence**, 200ms backoff capped at 2s. Do not reinvoke the model or
  release a running task with nowhere left to save its answer. A lost commit
  acknowledgement is resolved by reading authoritative status in the same
  finalizer: completed → finish, stopped → abort, failed/interrupted → error.
- Stop/delete races are decided in the finalization transaction, not by stale
  callback state. Unresolved saves cannot delete generated images; completed
  saves (including lost acknowledgements) keep them; authoritative discarded
  image batches are cleaned up. See [Image Generation](./image-generation.md).
- Disconnect only ends that subscription. Every new request/reconnect checks
  session and resource ownership, but an already-open SSE connection is not
  periodically reauthorized: revocation/ban may leave it receiving the current
  response. Explicit logout still destroys the client document/subscription;
  it does not cancel the account-owned generation. No periodic session wrapper.
- Explicit stop or topic/assistant deletion cancels inference and side effects.
  Deletion clears live content and durable associations; late chunks cannot
  recreate rows.
- Subscriber queues are bounded (currently 1024 unread chunks). Drop a slow
  subscriber, never the producer or another subscriber.
- Title generation is a server-side, best-effort post-turn task, protected
  against overwriting manual titles and cancelled on deletion. No browser
  callback is required; it does not delay reply completion.

### Client recovery and account boundary

- SDK baseline: `ai@7.0.170`, `@ai-sdk/react@4.0.174`. Keep POST SSE,
  `useChat`, the chat pool and regenerate placement; no custom UI state machine.
- Seed history **before** resume. Use `resumeStreamIsReplay: true` to replace
  the same message ID in place. A 204 resume requires canonical history
  refresh/reseed, not replay of an already seeded terminal answer. A duplicate
  POST uses the separate follow mode and may replay the saved answer once.
- Keep healthy SPA subscriptions; coalesce reconnects for one pool entry.
  The pool's single `generationId` serves Stop and reconnect; do not mirror it
  as a second pool field. HTTP `streamId` fields/headers remain unchanged.
  `noteSendStarted(chatId)` only marks an existing topic streaming immediately;
  drafts mark on `data-topic`. Do not restore dead `sendContext`/model-pick state
  for title generation, which is owned by the server.
  A network error is not a failed server generation and must not trigger POST.
- Account-scope history/detail/generation query keys. Clear document-owned
  pools, composer state and pending receipts only on confirmed logout/identity
  change, not transient auth loading/network errors. Both successful sign-out
  paths replace the document. Pending receipts store only `{ userId, requestId }`,
  never prompts or unused topic/timestamp fields; lookup after reload is GET only.
- Poll active discovery only when visible with known active work; entry/focus/
  reconnect/submission/stop are refresh triggers. Use Query's native visibility
  focus handling and default `refetchIntervalInBackground: false`, not a second
  visibility listener calling `refetch()` (which bypasses `enabled`). Hidden-page
  interval fetches are suppressed; this is not a promise that all timers stop.
  Fetch inactive history eagerly after finish so a later mount cannot seed
  stale content.

### Startup/shutdown and deployment

- In `src/instrumentation.ts`, put Node imports **inside a positive**
  `if (process.env.NEXT_RUNTIME === "nodejs")` block. An early return followed
  by Node imports is not equivalent for webpack's Edge compilation. Builds
  must not start the runner.
- Boot marks prior running tasks interrupted and prior stopping tasks stopped,
  preserving saved parts. Queued tasks may start. Never reinvoke inference for
  an already-started task after process loss.
- Let Next own process signals. `pnpm dev` runs `next dev` directly; there is
  no project signal interception, `process.exit` replacement, parent-timeout
  wrapper or required shutdown environment setting.
- SIGTERM and SIGKILL both promise only already-persisted content, not a final
  tail flush. The 10s checkpoint cadence is an attempt interval, not a maximum
  loss window; before the first successful checkpoint the answer can be empty.
- The explicit `stopGenerationRunner` API remains for tests: repeated calls
  share one promise, abort live work before waiting on starting claims, and
  share a 10s deadline. Calling it directly is not a test of natural Next exit.
- Persistent DB failure keeps the topic occupied until save succeeds or the
  process exits; next boot recovers from the last persisted checkpoint. No
  zero-tail-loss guarantee or cross-instance takeover.
- Migration is additive and normal image startup runs it. Rollback keeps new
  schema and saved messages; an old binary cannot perform new task recovery.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Missing/foreign task | 404 `generation.notFound` |
| Deleted target/receipt | 410 `generation.targetDeleted` |
| Same request ID, different payload | 409 `generation.requestConflict` |
| New malformed/expired/future request key | 400 `generation.invalidRequestId` / `requestExpired` / `requestClockAhead`; time errors include `serverTime` |
| Topic active / prepared context changed | 409 `generation.topicBusy` / `generation.contextChanged` |
| Active row cannot obtain producer during shutdown | 503 `generation.notRunning`, not an empty success |
| Terminal resume GET | 204, canonical history refresh |
| Provider failure after acceptance | Persist failed outcome + sanitized error before error chunk |
| Terminal persistence failure | Retain state and retry DB; no premature finish or model retry |
| Connection authorization expires | Reject new requests/reconnects; no periodic termination of an existing SSE subscription; task remains account-owned |

## 5. Good / Base / Bad Cases

- Good: close tab after `ABC`; model continues; reopen receives current `ABCDE`
  then `F` as `ABCDEF` on the same message, without a second model call.
- Base: leave the page open; ordinary POST SSE works, final state commits once.
- Bad: stop arrives during failed terminal save; a stale completed callback
  publishes finish or deletes images before the DB decides the outcome.

## 6. Tests Required

- `generation-stream.test.ts`: current prefix + delta, unfinished tool JSON,
  reasoning/metadata/source identity; no historical replay requirement.
- `generation.service.integration.test.ts`: real admission transactions,
  receipts/expiry/deletion, actual preparation ownership, topic exclusivity,
  selected versions, concurrent new/existing-topic receipt winners; real session
  revocation leaves an already-open HTTP response readable but rejects new
  send/resume/query/stop requests.
- `message.service.integration.test.ts`: public writers reject a foreign topic
  even with an explicit transaction; retain actual DB coverage, not just a
  mocked ownership function.
- `generation-execution.integration.test.ts`: real runner with local provider,
  edit context once, automatic compression, five independent topics, metadata,
  terminal-write failures and lost acknowledgements, stop/delete/image races.
- `generation-runner.integration.test.ts`: actual PostgreSQL locks for starting
  claims, checkpoint/finalization ordering, explicit runner stop, boot recovery
  and slow-subscriber isolation; no sleep-only proof.
- Real Next process validation: SIGTERM after an observed persisted checkpoint,
  restart and assert unchanged saved parts, interrupted state and no additional
  provider call. Also cover exit before the first checkpoint (empty placeholder
  is valid). Test dev/start without installing signal hooks; direct runner-stop
  tests do not establish framework exit behavior.
- Pool/ChatView/account tests: seed-before-resume, 204 reseed, one reconnect,
  retained target after network failure, account-key isolation. Real QueryClient
  tests cover hidden suppression, one return-visible fetch, resumed active
  polling, idle rediscovery, and disabled/anonymous queries staying inactive.
- `env.test.ts` currently imports real instrumentation in its runner-boot case:
  even a unit run needs explicit isolated `DATABASE_URL`/`TEST_DATABASE_URL`
  with migrated schema and no queued work. Never let this test inherit an
  application DB; it can execute boot recovery.
- Release validation: isolated DB, original image migration/stop/restart,
  SIGKILL after checkpoint, provider call count unchanged; distinguish project
  dev/start/standalone entry points and actual container engine. Never use
  production DB, paid providers or user object storage for integration tests.
- Real browser/mobile/scroll behavior remains a separate manual acceptance
  step; green protocol tests are not evidence of DOM interaction acceptance.

## 7. Wrong vs Correct

```ts
// Wrong: the browser owns inference; a final DB outage loses the only answer.
request.signal.addEventListener("abort", () => controller.abort());
try { await finalizeGeneration(input); }
finally { removeLiveGeneration(id); }

// Correct boundary: disconnect unsubscribes; runner retains state until the
// authoritative persistence decision, then publishes its terminal signal.
const result = await persistTerminal(input, row);
// completed -> finish; stopped -> abort; failed/interrupted -> error
```

The last snippet illustrates the runner boundary, not an exported helper API.
