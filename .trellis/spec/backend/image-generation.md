# Image Generation

> Cross-layer contract for in-chat image generation: a non-streaming bypass of
> the chat pipeline for models whose `outputModalities` include `image`.
> Landed with `09-21-image-generation`. Complements
> [Chat Attachments](./chat-attachments.md) (generated images are regular
> attachments) and [Chat Message Versions](./chat-message-versions.md)
> (regenerate joins the same version group).

## Scenario: a turn on an image-output model

### 1. Scope / Trigger

No new tables, no changes to the `streamText` pipeline. One isomorphic
capability table, one backend image service, and a non-streaming branch in
both streaming routes that still answers with the UI message stream protocol.

Modules:

```
src/lib/image-capabilities.ts          static family table + imageCapabilityFor() (client-safe)
src/server/ai/image/generate.ts        generateImageForEndpoint + per-format adapters + payload mapping
src/server/ai/image/turn.ts            assertImageGenerationSupported + createImageGenerationResponse
src/app/api/chat/route.ts              imageGenerationResponse branch (announceTopic)
src/app/api/topics/[id]/messages/[messageId]/regenerate/route.ts   same branch (groupId)
src/server/services/title.service.ts   image-model short-circuit
src/server/ai/attachments.ts           assistant file parts dropped from the payload
```

### 2. Signatures

```ts
// lib/image-capabilities.ts — client-safe, same role as provider-format.ts
type ImageSizeMode = "openai-size" | "aspect-ratio" | "freeform";
type ImageModelCapability = {
  sizeMode: ImageSizeMode;
  sizes: string[];        // openai-size/freeform: "WxH" tiers; aspect-ratio: "1:1"
  nMax: number;
  qualities?: string[];   // OpenAI-style tiers
  imageSizes?: string[];  // Gemini imageConfig.imageSize tiers ("1K"|"2K"|"4K")
  freeform?: ImageFreeformConstraints;  // freeform only: { divisibleBy?, ratioMin?, ratioMax?, minSide?, maxSide?, minPixels?, maxPixels? }
};
imageCapabilityFor(modelId: string): ImageModelCapability
validateFreeformSize(size: string, constraints?: ImageFreeformConstraints): boolean  // shared by turn.ts, image-params.ts, and the picker
DEFAULT_IMAGE_CAPABILITY  // freeform (no constraints), 5 preset ratios, nMax 1

// server/ai/image/generate.ts
type GeneratedImage = { bytes: Buffer; mediaType: string };  // png/jpeg/webp/gif
type ImageGenParams = { prompt: string; size?: string; n: number; quality?: string; imageSize?: string };
type ImageGenResult = { images: GeneratedImage[]; text?: string };  // Gemini may attach text
generateImageForEndpoint(endpoint, modelId, params, signal?): Promise<ImageGenResult>

// server/ai/image/turn.ts
assertImageGenerationSupported(apiFormat, modelId, image: ImageGenerationParams | undefined): void
createImageGenerationResponse({ actor, handle, t, providerConfigId, modelId, image,
  prompt, topicId, groupId?, announceTopic }): Promise<Response>
```

Request schema: `chatRequestSchema` and `regenerateMessageRequestSchema` both
carry an optional `image: { size?, n?, quality?, imageSize? }`
(`imageGenerationParamsSchema` in `src/lib/schemas/chat.ts`). All new fields
are optional — old clients are unaffected.

### 3. Contracts

**Capability resolution is two-layered.** Provider listing endpoints do not
return image parameters, so: modality (does this model output images) comes
from the models.dev catalog snapshot (`provider_models.output_modalities`),
while parameter support (which sizes/counts/qualities) comes from the static
family table in `image-capabilities.ts`. The table matches the lowercase last
path segment of the model id (`google/gemini-2.5-flash-image` →
`gemini-2.5-flash-image`); **rule order is priority** — more specific families
precede broader ones (`gpt-image-2.5` before `gpt-image-2` before `gpt-image-1`,
since the ids nest); unknown models land on `DEFAULT_IMAGE_CAPABILITY`
(freeform presets + custom "WxH" input, nMax 1). The composer renders options
from the same table the server validates against — one source, both sides.

Freeform is not always unconstrained: gpt-image-2/2.5 require both sides
divisible by 16 with aspect ratio within 1:3–3:1 and no side above 3840;
seedream-4.5/5.0-lite and the qwen-image-2.0/3.0 families bound the **total
pixel count** instead (`minPixels`/`maxPixels` — e.g. 1024×1024 is rejected on
seedream-4.5). The wan families split three ways (DashScope docs, 2026-09):
`wan2.7-image-pro` allows 768²–4096² total pixels at ratios 1:8–8:1, every
other `wan2.*` id caps at 2048² (ratio bounds for 2.5/2.6 are tighter
upstream; we stay permissive and let the 400 pass through), and legacy `wanx*`
(2.1 and below) is bounded **per side** to [512, 1440] via `minSide`/`maxSide`
— the qwen fixed-tier table never applies to wan ids. Such families carry
`freeform` constraints, and
`validateFreeformSize` enforces them in three places: the picker's
custom-size input, the pre-send sanitize, and the server-side
`assertImageGenerationSupported` backstop (400 `image.invalidParams`). The
default family stays unconstrained. Gemini splits by generation:
gemini-3-pro-image / 3.1-flash-image take 15 aspect ratios and 1K/2K/4K, while
gemini-2.5-flash-image / 3.1-flash-lite-image take 10 ratios and 1K only —
offering 2K/4K on the latter would surface as an upstream 400.

**Branch placement (`/api/chat`).** After `requireModelForActor`, before any
topic row exists — the "unusable model leaves no draft behind" ordering is
preserved:

```
selected.outputModalities.includes("image")
  ├─ message carries a file part → 400 image.attachmentUnsupported
  ├─ assertImageGenerationSupported → 400 model.imageUnsupported / image.invalidParams
  └─ → image path: appendUserMessage → generateImageForEndpoint
       → uploadFile per image → createUIMessageStream (one complete message)
```

The bypass skips everything text-pipeline-only: history/compression, tools,
attachment routing, reasoning, system prompt. The prompt is the user
message's text.

**Regenerate branch.** Same gate and same `createImageGenerationResponse`,
with two differences: the prompt is the text of the last user message in the
target history, and the answer joins the target version group via `groupId`
(`is_selected` switching is the existing mechanism). No `data-topic` chunk —
the stream id rides in the `x-pika-stream-id` header as on the streaming
regenerate route. `/api/chat` instead announces the (possibly freshly
created) topic via a `data-topic` chunk (`announceTopic: true`).

**The response speaks the UI message stream protocol.** A single non-streaming
generation still returns `createUIMessageStreamResponse`: `start` carries the
message id `onEnd` persists (B6 — follow-up actions reference it), each image
is written as a `file` chunk, accompanying Gemini text as text chunks, and
`finish` carries `messageMetadata` `{ providerConfigId, modelId, createdAt }`.
This is deliberate — the client's consumption path is byte-identical to
streaming, no second response protocol.

**Generated images are regular attachments.** Each image goes through
`file.service.uploadFile` (owner = actor, quota via `assertUploadQuota`,
storage backend, `files` row, `generated.<ext>` filename by media type) with
`skipSizeLimit: true` — the per-file upload cap (`FILE_UPLOAD_MAX_MB`) guards
user uploads, and a 4K render legitimately outgrows it; the storage quota
still applies. Images land on the assistant message as ordinary
`chatFilePart`s (`url: /api/files/<id>`). Delete cascade and the orphan sweep
apply with zero extra wiring.

**Mid-batch cleanup.** Images upload one at a time; if a later upload fails
(quota, storage) the rows already written are deleted best-effort
(`deleteFile`, cleanup errors only logged) so a failed batch never leaves
unreferenced rows counting against the quota. The same cleanup runs when a
stop lands *between* generation and the upload loop (the loop checks
`abortSignal.aborted` before each upload) — an abort during generation itself
throws and is caught by the same path.

**Persistence is all-or-nothing.** Parts accumulate in the stream's `execute`
closure and `onEnd` persists them only on `completed`: a failed turn persists
`outcome: "failed"` + scrubbed `errorMessage` (same shape as a streaming
failure, via the shared `createStreamFailureTracker`), an aborted turn
persists `outcome: "stopped"` — never half-written images. `Stop` works
through the same `stream-registry`: `registerStream`/`releaseStream` wrap the
call and `POST /api/chat/stop` aborts it.

**Provider dispatch.** `FORMAT_ADAPTERS` is a
`Record<ProviderApiFormat, ImageAdapter | null>` keyed exhaustively like
`provider-factory.ts` — adding a format fails compilation here. `claude` is
`null`; the routes reject claude image models at the pre-flight gate, and the
`null` arm is a defensive backstop.

| format | endpoint | notes |
|---|---|---|
| `openai-compatible` | `POST {baseUrl}/images/generations` | `response_format: "b64_json"` always requested; a gateway answering `url` is downloaded server-side with the same signal. b64 payloads get their media type sniffed from magic bytes (png/jpeg/webp/gif), falling back to png. Key optional, like discovery. |
| `google` | `POST {baseUrl}/models/{model}:generateContent` | `generationConfig.responseModalities: ["TEXT","IMAGE"]`; `imageConfig.aspectRatio`/`imageSize` only for aspect-ratio models. One image per call, so `n` fans out into `n` parallel requests merged into one message. `inlineData` parts → images, `text` parts → the optional text; parts flagged `thought: true` (Gemini 3 thinking) are skipped. |

**Timeout.** Generation is slow: `AbortSignal.any([callerSignal, AbortSignal.timeout(120s)])`
— well above the 10s discovery timeout.

**`imageSize` is google-only.** The resolution tier has no openai-compatible
counterpart, so `turn.ts` strips it before dispatching when
`apiFormat !== "google"` — otherwise a gateway serving a Gemini image model
over the images endpoint would silently render 1K while the user picked 2K.

**Title short-circuit.** The title fallback pair is the composer's current
model; when it is image-only, `generateText` is guaranteed to fail and burn
the 15s timeout. `title.service` checks the fallback pair's
`outputModalities` first and goes straight to the truncated-text title. An
explicit title preference naming an image model is honored as-is — the
existing catch degrades it to the same fallback.

### 4. Validation & Error Matrix

| Condition | code | status | messageKey |
|---|---|---|---|
| image model on a `claude` config | `VALIDATION_FAILED` | 400 | `model.imageUnsupported` |
| message carries a file part | `VALIDATION_FAILED` | 400 | `image.attachmentUnsupported` |
| size/n/quality/imageSize outside the capability table | `VALIDATION_FAILED` | 400 | `image.invalidParams` (`{param}`) |
| provider non-2xx | `PROVIDER_ERROR` | 502 | `provider.*` via `describeProviderError`; a 400's legal-values text passes through scrubbed-verbatim |
| malformed/empty provider response (no images) | `PROVIDER_ERROR` | 502 | `provider.unexpectedResponse` |
| quota exceeded while storing a generated image | `QUOTA_EXCEEDED` | 413 | `file.quotaExceeded` |
| generation fails after the stream opened | — | 200 | failed assistant row: `outcome: "failed"` + `errorMessage`, delivered in-stream |
| user stops / client aborts | — | 200 | assistant row persisted with `outcome: "stopped"`, no parts |

Freeform models additionally accept any `WxH` custom size
(`FREEFORM_SIZE_PATTERN`) beyond their presets; every rejected parameter
throws **before** any persistence, so a rejected turn leaves nothing behind.

### 5. Good / Base / Bad Cases

- **Good**: gemini image model, n=2 → two parallel `generateContent` calls →
  two `uploadFile` rows → one assistant message with two file parts,
  delivered over a stream the client already speaks.
- **Base**: unknown image model id → `DEFAULT_IMAGE_CAPABILITY` (freeform,
  nMax 1); custom `1536x640` passes the server gate verbatim.
- **Bad**: routing assistant file parts back into the model payload, or
  building a second response protocol for the single-shot answer — both are
  covered in Wrong vs Correct.

### 6. Tests Required

- `image-capabilities.test.ts`: every family hit, case/prefix variants,
  unknown model → default, rule-order priority.
- `server/ai/image/generate.test.ts`: per-format request body shapes,
  b64_json and url responses (url triggers a download with the signal),
  Gemini mixed inlineData+text, timeout/abort, non-2xx → `APICallError`
  mapping, `.nullish()` tolerance of explicit `null`s.
- `api/chat/route.test.ts`: branch decision, all three 400s before any topic
  row, success message shape, failure persisted as `failed` + `errorMessage`.
- regenerate `route.test.ts`: image regenerate produces a new version in the
  target group with `is_selected` switched; prompt taken from the last user
  message.
- `attachments.test.ts`: assistant-role file parts dropped (also on the
  no-user-attachment fast path), a parts-less assistant message removed from
  the payload.
- `title.service` test: image-output fallback pair never calls
  `generateText`; explicit image-model preference still goes through the
  catch fallback.

### 7. Wrong vs Correct

#### Wrong

```ts
// Feeding the whole selected history to the model on a mixed-model topic.
// Assistant messages carry generated images as file parts; routing them back
// kills the topic three ways: a text-only model 400s with
// file.imageRequiresVision, the google adapter throws on an assistant-role
// image it cannot serialize, and stripping them leaves an empty assistant
// turn the provider rejects.
const modelMessages = await toModelMessages(history);
```

#### Correct

```ts
// resolveAttachmentsForModel drops assistant-role file parts outright (they
// are model output, not input) and removes a message left with no parts.
if (message.role !== "user") {
  partsChanged = true;
  continue;  // generated-image output: never routed back into the payload
}
```

#### Wrong

```ts
// A Gemini-compatible gateway answers with explicit `null` for unset fields;
// `.optional()` permits only `undefined`, so HTTP 200 responses get rejected
// as unexpected. Same lesson as discovery (provider-configs spec).
inlineData: z.object({ data: z.string().optional() }).optional(),
```

#### Correct

```ts
inlineData: z.object({ data: z.string().nullish() }).nullish(),
```

### Design Decisions

**A bypass, not a pipeline.** Image models get one non-streaming call that
skips history, compression, tools, and attachment routing — none of which
mean anything to a single-shot generator. The cost is duplicated topic
resolution in the branch; the win is that `streamText` and its retry/failure
machinery stay untouched.

**One response protocol.** The answer is delivered through
`createUIMessageStream` so the client's consumption, persistence, and
reseed logic are byte-identical to streaming. A bespoke JSON response would
have forked the frontend message pipeline for zero user-visible gain.

**Static capability table, not DB config.** Parameter support lives in code
(`image-capabilities.ts`) with a freeform escape hatch (custom "WxH" input)
covering the long tail. A DB-backed table would add admin surface for data
that changes at the pace of model releases — code review pace.

**Generated images are just attachments.** Reusing `uploadFile` means quota,
storage backends (local/S3), orphan sweep, delete cascade, and the
management page all work with zero image-specific code. The alternative —
a parallel blob store — buys nothing.

**Params are not persisted on the message.** No "reuse these settings" on
generated messages (YAGNI); the composer's per-draft picks are session-only
client state. Add message-side persistence if reuse demand materializes.
