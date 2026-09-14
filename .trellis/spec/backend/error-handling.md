# Error Handling

> How errors are raised, translated, and returned — including the streaming
> case, which does not behave like a normal response.

---

## The model

Services **throw typed errors**. The transport boundary **translates** them.
Services never return an HTTP status, and Route Handlers never invent an error
shape inline.

```ts
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,   // stable, machine-readable
    readonly status: number,       // http status at the boundary
    readonly messageKey: AppErrorMessageKey, // key into the `Errors` catalog
    readonly params?: ErrorMessageParams,    // ICU values for the key
    readonly details?: unknown,    // field-level info, never secrets
  ) {
    super(messageKey);
  }
}
```

`code` is the contract. Clients — including a future mobile client — branch on
`code`, never on the display text. The display text is no longer produced
server-side: `messageKey` + `params` are resolved and localized by the client
against `messages/<locale>.json` (see
[frontend/i18n.md](../frontend/i18n.md)). `AppErrorMessageKey` is derived from
the `Errors` catalog, so a throw site with a non-existent key does not compile.
`Error.message` carries the raw key for stack traces only.

Common codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`,
`CONFLICT`, `QUOTA_EXCEEDED` (413, a limit the caller cannot argue with rather
than a malformed request), `RATE_LIMITED`, `PROVIDER_ERROR`, `INTERNAL`.

---

## Response shape

One shape for every failure, on every endpoint:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "messageKey": "validation.failed",
    "params": { "minimum": 3 },
    "details": { "fieldErrors": { "title": { "key": "required" } } }
  }
}
```

There is no English `message` field. `params` is omitted when the key needs
none; `details` is omitted when there is nothing field-level to say.

A single `withErrorHandling` wrapper around Route Handlers performs the
translation. Do not write per-handler try/catch — divergence there is how error
shapes fragment across an API.

Unrecognized throwables map to `INTERNAL` with `messageKey: "unexpected"` and
`details.requestId`. The real error goes to the log with the same correlation
id; the client gets the id, not the stack.

---

## Validation

Zod parses at the boundary, and only at the boundary. A `ZodError` translates to
`VALIDATION_FAILED` with `messageKey: "validation.failed"` and
`details.fieldErrors[field] = { key, params? }` — `key` is a `Validation`
catalog key derived from the Zod issue code (`invalid_type` → `invalidType`,
`too_small` → `tooSmall` with `minimum`, unknown codes → `invalid`). Raw Zod
English text is never returned; neither are the offending input values.

Services trust their input types because the boundary already guaranteed them.
Re-validating inside services duplicates the contract in two places, which
reliably drift.

---

## Not-found versus forbidden

For user-owned resources, return `NOT_FOUND` when the ownership filter matches
nothing — do not distinguish "does not exist" from "belongs to someone else".
Distinguishing them turns any id-guessing loop into an existence oracle.

Use `FORBIDDEN` only where the resource is legitimately visible to the caller
but the *action* is not, such as a regular user attempting an admin operation.

---

## Never leaked

Provider API keys, encryption secrets, session tokens, password hashes, raw
stack traces, and upstream provider error bodies must never reach a client
response. An upstream provider failure is wrapped as `PROVIDER_ERROR` with a
summarized message — provider errors routinely echo back request payloads,
which can contain the key or the user's message.

What *is* shown to the user is the upstream `error` field, and only that field:
`describeProviderError` lifts `error` out of the body, scrubs every string in
it (API key, `Authorization`/`Bearer`/`Basic` values, credential-named fields,
the configured base URL and its host), and clamps the result. Narrowing to
`error` rather than shipping the whole body is what keeps a gateway's request
echo out: the echo lands elsewhere in the response. See
`src/server/ai/provider-error.ts`.

---

## Streaming errors

Streaming is where this gets genuinely different, and it is the part most
easily gotten wrong.

**Once headers are sent, you cannot change the status code.** A failure at
token 500 cannot become a 500 response — the client already has a `200`. Errors
after the stream opens must be delivered *inside* the stream and rendered as a
failed message in the UI, not thrown away.

The stream can only carry text, so the envelope contract does not apply. Our
wrapper copy goes through `providerErrorText(description, t)` where `t` is the
request-scoped `getTranslations("Errors")` — keys are localized for the active
locale at stream time. Upstream provider detail is passed through **verbatim**
(`kind: "verbatim"`): third-party output is not ours to translate or
paraphrase. `describeProviderError` returns the discriminated description;
`src/app/api/chat/route.ts` and the regenerate route resolve it for both the
stream error event and the persisted `error_message`.

### Do not trust `outcome.status`

The AI SDK does not report every provider failure as
`outcome.status === "failed"`. A fatal stream error — what a bad key, a
missing model, or a dead endpoint produces — reaches `onEnd` as
`{ status: "unknown" }`. Branching on `outcome.status` alone persisted those
turns as `completed` with a null `error_message` and no text parts: the reason
never left the server, and the transcript showed an empty bubble that survived
reloads.

So both streaming routes track the failure themselves, through the shared
`createStreamFailureTracker` in `src/server/ai/stream-failure.ts`. Its
`describe(error)` is wired into **two** hooks and records that the turn failed:

- the `onError` passed to `toUIMessageStream` — **required**. Without it the
  error chunk carries the SDK's own `"An error occurred."` to the client and
  the text we computed for the row is never delivered, so live and reloaded
  views disagree.
- the `onError` on `createUIMessageStream`, which catches anything that escapes
  the inner wrapper.

The first resolution wins, so the text the row persists and the text the client
receives are the same string by construction. `onEnd` then treats
`failure.sawFailure || outcome.status === "failed"` as a failed turn. Anything
that decides a turn's outcome from the stream must be tested against a model
that fails after the stream has opened, not only against a happy path.

### Retries, and why the error object is not always the provider's

`APICallError`'s constructor defaults `isRetryable` from the status code
(`408`, `409`, `429`, `5xx` → true). That default is what makes an upstream
failure retryable — the `openai-compatible` provider passes no `isRetryable`
of its own, so the status code alone decides. After the attempts are exhausted
the retry wrapper **replaces** the error with a `RetryError`, whose
`APICallError` only survives in `.lastError` / `.errors[]`.

Consequences to keep in mind:

- A 5xx is not shown as "the provider returned 503" — by the time it reaches
  the routes it is an `AISDKError`, and `APICallError.isInstance` is false.
- Both routes pass `maxRetries: 1`, not the SDK default of 2. With a doubling
  backoff the default means 2s + 4s of dead time before a deterministic
  failure is reported; one retry keeps a single 2s pause.
- `describeProviderError` unwraps `RetryError.lastError` before describing.
  Keep that step: without it every 408/409/429/5xx reports the generic
  "unreachable" copy — a rate limit presented as a connectivity problem, with
  the real body discarded. The regression test drives a real local endpoint
  returning 503 and asserts the provider's own text survives.

Use the AI SDK's error handling on the stream response so the failure reaches
the client as a stream event rather than a silently truncated response. A
truncated stream is indistinguishable from a finished one on the client, which
is why silent truncation shows up as "the model just stopped mid-sentence".

**Do not treat a client disconnect as a failure.** Closing a tab, navigating
away, or backgrounding a mobile app aborts the HTTP connection. That is a
resumable disconnect, not a cancellation, and the persisted message must
survive it. Explicit user cancellation is a separate, deliberate signal — a
dedicated stop endpoint — not an inferred one.

This distinction is what makes later stream-resumption work possible. Getting
it wrong now means a mobile user loses every answer they switch away from.

Persist the assistant message on stream completion **server-side**, in the
`onFinish` callback — not from a client callback. The client may be gone.

Topic titles are a separate `POST /api/topics/:id/title` request. Do not
await title generation in the chat stream `onEnd` — that couples Stop and
`inFlight` to titling. A slow or failed title call must not fail the turn.
