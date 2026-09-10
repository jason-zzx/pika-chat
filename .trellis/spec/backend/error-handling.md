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
`CONFLICT`, `RATE_LIMITED`, `PROVIDER_ERROR`, `INTERNAL`.

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
response. Upstream provider failures are wrapped as `PROVIDER_ERROR` with a
summarized, verbatim message — provider errors routinely echo back request
payloads, which can contain the key or the user's message.

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
