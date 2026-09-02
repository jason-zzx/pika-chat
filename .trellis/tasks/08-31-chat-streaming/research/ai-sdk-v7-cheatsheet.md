# AI SDK v7 Cheatsheet (ai@7.0.85 / @ai-sdk/react@4.0.88)

Condensed from `ai-sdk-v7-streaming-api.md` (63 KB, exceeds the context
injection limit and gets truncated before its pitfall list and code samples).
**This file is the one to read before writing chat code.** Consult the full
document for evidence, `.d.ts` line anchors, and the reasoning behind each
claim.

Evidence markers: `[T]` local `.d.ts`, `[D]` official docs, `[?]` inference.

---

## 1. Versions

| Package | Version | Note |
|---|---|---|
| `ai` | 7.0.85 | installed |
| `@ai-sdk/react` | 4.0.88 | installed; major does **not** track `ai` |
| `@ai-sdk/openai-compatible` | **3.0.41** | to install — pins the same `@ai-sdk/provider@4.0.9` / `provider-utils@5.0.34` as `ai@7.0.85` |

Do not "fix" the version mismatch. `ai@7` pairs with `@ai-sdk/*@4`-era packages
by design (`.trellis/spec/backend/index.md:36-42`). Installing
`@ai-sdk/openai-compatible@2.0.74` resolves `LanguageModelV3` and will not
type-check.

---

## 2. Renamed / removed API

Writing from v3/v4 memory produces code that either fails to compile or, worse,
compiles and silently misbehaves.

| Old (v3/v4) | Current (ai@7) |
|---|---|
| `result.toDataStreamResponse()` | **gone entirely** — use `createUIMessageStreamResponse` |
| `result.toUIMessageStreamResponse()` | `@deprecated` — use standalone `toUIMessageStream` + `createUIMessageStreamResponse` |
| `streamText({ system })` | `instructions` |
| `streamText({ maxTokens })` | `maxOutputTokens` (the old name does not exist) |
| `streamText({ onFinish })` | `onEnd` |
| `toUIMessageStream({ onFinish })` | `onEnd` |
| `onStepFinish` | `onStepEnd` |
| `useChat({ initialMessages })` | `messages` |
| `useChat({ api, body, headers })` | **do not exist** — use `transport: new DefaultChatTransport({...})` |
| `useChat()` → `input`, `handleInputChange`, `handleSubmit`, `append`, `reload`, `isLoading` | **all removed** — own the input yourself, use `sendMessage`, `regenerate`, `status` |
| `addToolResult` | `addToolOutput` |
| `experimental_throttle` | `throttle` |
| `convertToModelMessages(...)` sync | **async** — must `await` |

`useCompletion` in the same package *does* still have `input` /
`handleSubmit`. Do not let that mislead you.

---

## 3. Route Handler

```ts
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type ToolSet,
  type UIMessage,
} from "ai";

export type ChatMetadata = { modelId?: string; totalTokens?: number };
export type ChatUIMessage = UIMessage<ChatMetadata>;

const result = streamText({
  model,
  messages: await convertToModelMessages(messages), // MUST await
  instructions: systemPrompt ?? undefined,          // NOT `system`
  abortSignal: registrySignal,                      // NOT req.signal — see pitfall 2
  onError: ({ error }) => { logger.error({ err: error }, "streamText failed"); },
});

// Drain backpressure so a disconnected client cannot stall generation.
// Do NOT await.
void result.consumeStream();

const stream = createUIMessageStream<ChatUIMessage>({
  originalMessages: messages,        // required, else no persistence mode
  execute: ({ writer }) => {
    writer.write({ type: "data-topic", data: { topicId, streamId } });
    writer.merge(
      toUIMessageStream<ToolSet, ChatUIMessage>({
        stream: result.stream,
        sendStart: false,            // avoid a duplicate `start` chunk
      }),
    );
  },
  generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
  onEnd: async ({ responseMessage, outcome, isAborted }) => {
    // persist here — see §5 for the outcome mapping
  },
  onError: (error: unknown) => {
    logger.error({ err: error }, "chat stream error");
    return userFacingMessage(error);  // returned string reaches the client
  },
});

return createUIMessageStreamResponse({ stream });
```

`createUIMessageStreamResponse` already sets `x-accel-buffering` to suppress
nginx buffering `[T:6095-6102]`.

Keep the default Node runtime. Do **not** add `export const runtime = 'edge'` —
`postgres`, `pino`, and the AES-256-GCM decryption all need Node.

---

## 4. Frontend

```tsx
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const { messages, status, error, sendMessage, stop, setMessages } =
  useChat<ChatUIMessage>({
    id: chatId,                 // stable for the component's lifetime
    messages: history,          // NOT initialMessages
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages, trigger }) => ({
        body: {
          assistantId,
          topicId,
          providerConfigId,
          modelId,
          message: messages[messages.length - 1], // send only the new one
        },
      }),
    }),
  });
```

`status` is `'submitted' | 'streaming' | 'ready' | 'error'` `[T:5468]`.
"In flight" is `submitted` or `streaming`.

`trigger` values are `'submit-message'` / `'regenerate-message'` `[T:5660]`.
The official chatbot docs print `'submit-user-message'` and add a `throw`
fallback — copying that throws at runtime.

Render `message.parts`, not `message.content`:

```tsx
{message.parts.map((part, i) =>
  part.type === "text" ? <Streamdown key={i}>{part.text}</Streamdown> : null,
)}
```

---

## 5. Persistence

Persist in `onEnd`, and only at the `toUIMessageStream` /
`createUIMessageStream` layer. `streamText`'s own callback yields
`ModelMessage`-shaped data with no `parts` and no ids — unusable for rebuilding
the transcript.

`onEnd` gives `{ messages, responseMessage, outcome, isAborted }`:

- `responseMessage` is just the new assistant message. Prefer it; `messages` is
  the entire history, not a delta `[T:2480-2508]`.
- `isAborted` true → the turn was cancelled (persist the partial as `stopped`).
- `outcome.status === "failed"` → persist as `failed` with the sanitised text.
- otherwise → `completed`.

Store `UIMessage` shape (the `parts` array). `UIMessage → ModelMessage` is
lossy and one-way, so plain text cannot round-trip.

Attach per-message data through `messageMetadata`:

```ts
messageMetadata: ({ part }) =>
  part.type === "finish"
    ? { modelId, totalTokens: part.totalUsage.totalTokens }
    : undefined,
```

Returning `undefined` is legal `[T:2573-2575]`. Note `part.totalUsage` on the
stream part versus `usage` on the event object — same concept, two names.

---

## 6. Model instantiation

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

const provider = createOpenAICompatible({
  name: config.name,
  baseURL: config.baseUrl,   // already contains /v1 in this project
  apiKey: plaintextKey,
  includeUsage: true,        // else streaming returns no usage at all
});
const model: LanguageModel = provider.chatModel(modelId);
```

`baseURL` must include `/v1`; the provider appends `/chat/completions` to it.
In this project base URLs are **stored with** `/v1`
(`08-31-providers/design.md:164-166`, form placeholder
`src/components/provider/ProviderConfigForm.tsx:81`, and `discovery.ts:32`
building `${baseUrl}/models`). Pass it through unchanged — do not strip or
append.

---

## 7. Pitfalls, worst first

**Silent failure / data loss**

1. **Forgetting `result.consumeStream()`** — backpressure stalls the upstream
   read and `onEnd` never fires, so nothing persists when the client
   disconnects. Call it, do not await it.
2. **`abortSignal: req.signal` cancels out `consumeStream()`** — the client
   disconnecting aborts generation outright. For server-authoritative
   persistence, never pass `req.signal`. Pass your own controller's signal when
   you need explicit cancellation.
3. **Persisting at the wrong layer** — `streamText({ onEnd })` cannot rebuild a
   `UIMessage`.
4. **Omitting `originalMessages`** — persistence mode is not entered and the
   response message gets no id `[T:2552-2560]`.
5. **Top-level `api` / `body` / `headers` on `useChat`** — silently ignored;
   `useChat` falls back to a bare `DefaultChatTransport`, posts to `/api/chat`
   with none of your fields. The reference doc's parameter table is wrong.

**Compile-time (TS strict catches these)**

6. `convertToModelMessages` is async `[T:5649]`.
7. `streamText.messages` takes `ModelMessage[]` `[T:715]`; `useChat.messages`
   is `UIMessage[]`. Convert at the boundary.
8. `toDataStreamResponse` does not exist.
9. `toUIMessageStreamResponse` is deprecated.
10. See the rename table in §2.
11. `useChat` no longer manages input.

**Data consistency**

12. `part.totalUsage` (stream part) vs `usage` (event object).
13. Every `LanguageModelUsage` field can be `undefined` `[T:320-370]` —
    third-party OpenAI-compatible endpoints frequently omit usage. Handle
    undefined before writing, and set `includeUsage: true`.
14. **User message ids are generated client-side** before the request is sent.
    Server authority over them requires an explicit choice: accept the client
    id, or regenerate server-side and accept that the client's in-memory copy
    disagrees.
15. `baseURL` without `/v1` yields a 404 that reads like "model not found".
16. `trigger` values — see §4.
17. `onEnd.messages` is the full array, not a delta.
18. `stopWhen` defaults to `isStepCount(1)` `[T:3463]`. Irrelevant without
    tools; mandatory to revisit when tool calling arrives.
19. `sendReasoning` defaults to **true** `[T:2578-2580]` — a reasoning model's
    chain of thought is sent to the client unless you set it `false`.

**Platform**

20. Keep the Node runtime (see §3).
21. `export const maxDuration` targets serverless platforms. Self-hosted, the
    real long-connection killers are the reverse proxy
    (`proxy_read_timeout`, `proxy_buffering off`) and Node's server timeouts.
22. `messageMetadata` returning `undefined` is legal.
