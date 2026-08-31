# Logging Guidelines

> Structured logging with pino. What to log, what must never be logged.

---

## Logger

One shared pino instance from `src/server/logger.ts`. JSON in production,
`pino-pretty` in development.

Never `console.log` in server code. It bypasses levels, redaction, and
structure, and it is invisible to whatever the operator pipes logs into.

---

## Levels

| Level | Use for |
|---|---|
| `error` | The request failed and a human may need to act. Unexpected throwables, provider outages. |
| `warn` | Degraded but handled. Catalog refresh fell back to the bundled snapshot; a provider retry succeeded. |
| `info` | Notable state transitions. Server start, migration applied, user created, provider config changed. |
| `debug` | Development detail. Off in production. |

`info` is not a trace channel. One line per request is the ceiling — a
self-hosted operator tailing logs should be able to read them.

---

## Structure

Log objects, not interpolated strings, so fields stay queryable:

```ts
// Good
logger.info({ userId, topicId, model: modelId }, "chat completion started");

// Bad
logger.info(`chat for ${userId} on ${topicId}`);
```

Attach a request id to every line within a request so a failure can be traced
across layers. Return that same id in `INTERNAL` error responses — it is the
only bridge between "the user saw an error" and "the operator finds the cause".

---

## Never logged

This is a chat product holding people's conversations, self-hosted by someone
who is often not a security specialist. The log file is a plaintext artifact
that gets pasted into GitHub issues.

Never log, at any level, including `debug`:

- Provider API keys, in plaintext or ciphertext
- The encryption secret, session tokens, bearer tokens, password hashes
- **Message content** — user prompts and model completions
- Full request bodies of chat endpoints
- Upstream provider error bodies verbatim (they echo the request, which
  contains both the key and the prompt)

Log *about* a message instead of logging the message: ids, token counts,
model id, latency, finish reason.

Configure pino's `redact` for `authorization`, `cookie`, `apiKey`, and
`set-cookie` as a backstop. Redaction is the safety net, not the plan — the
plan is not passing those objects to the logger in the first place.

---

## What is worth logging

- Request lifecycle: method, path, status, duration, request id, user id.
- Auth events: login success and failure, invite issued, invite accepted, role
  change. These are what an operator needs after a suspected compromise.
- Provider calls: provider id, model id, token usage, latency, finish reason,
  error code. Never the prompt.
- Admin mutations: who changed which provider config, and whether visibility
  changed. Visibility changes affect every user's spend.
- Catalog refresh: source, model count, outcome, fallback taken.
