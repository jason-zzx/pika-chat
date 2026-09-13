# Chat Attachments

> Upload → storage → extraction → model-payload routing. The cross-layer
> contract for file attachments in chat turns.

---

## Scenario: file attachments in a chat turn

### 1. Scope / Trigger

Touches a new DB table, two new Route Handlers, a storage backend (local disk,
env-wired), and a cross-layer payload rewrite (UI message parts → model
messages). The routing decision depends on the selected model's
`provider_models.input_modalities`, so the same persisted message reaches a
model differently each turn.

Modules:

```
src/server/files/storage.ts        FileStorage + LocalDiskFileStorage + getFileStorage()
src/server/files/file.service.ts   upload/get/delete/cascade/orphan sweep + presign/complete
src/server/files/limits.ts         maxFileBytes() / isS3DirectAccessEnabled()
src/server/files/provider-delete.ts  provider-side delete linkage + bounded retry queue
src/server/files/extract/          extractDocument() media-type dispatcher
src/server/ai/attachments.ts       resolveAttachmentsForModel()
src/lib/files/                     isomorphic media-type table + upload limits
src/app/api/files/route.ts         POST (+ GET list, phase 3)
src/app/api/files/[id]/route.ts    GET / DELETE
src/app/api/files/limits/route.ts  GET  (maxFileBytes / maxAttachmentsPerMessage / directUpload)
src/app/api/files/presign/route.ts POST (404 when S3_DIRECT_ACCESS is off)
src/app/api/files/complete/route.ts POST (404 when S3_DIRECT_ACCESS is off)
```

### 2. Signatures

```ts
// storage.ts
interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
getFileStorage(): FileStorage          // singleton; S3-compatible when S3_BUCKET is set, else local disk

// extract/index.ts
extractDocument(buffer: Buffer, mediaType: string, filename?: string): Promise<ExtractionResult>
// ExtractionResult = { status: "ok" | "empty" | "failed"; text: string; truncated: boolean; error?: string }

// ai/attachments.ts
resolveAttachmentsForModel(
  messages: ChatUIMessage[],
  caps: {
    inputModalities: string[],
    apiFormat: ProviderApiFormat,      // gates audio/video serialization
    providerConfigId: string,          // namespace for provider file references
    filesApi: FilesApiProvider | null, // null for openai-compatible: always inline
  },
): Promise<ChatUIMessage[]>          // pure: returns new arrays, persisted parts untouched

// ai/provider-files.ts
ensureProviderReference({ file, configId, apiFormat, filesApi }):
  Promise<{ kind: "reference"; reference: ProviderReference } | { kind: "fallback" }>
  // never throws; `fallback` means inline the bytes as before

// files/limits.ts
maxFileBytes(): number          // FILE_UPLOAD_MAX_MB (1..100) or 20 MiB
isS3DirectAccessEnabled(): boolean  // S3_DIRECT_ACCESS truthy AND S3_BUCKET set

// storage.ts — optional; S3FileStorage only (local disk has no direct-access meaning)
createPresignedPost?(key, { maxBytes, expiresSec }): Promise<{ url: string; fields: Record<string, string> }>
createPresignedGet?(key, { expiresSec, responseContentType, responseContentDisposition }): Promise<string>

// files/file.service.ts
presignFile({ filename, mediaType }, actor): Promise<{ fileId, post }>
  // validates the media type, inserts a pending row (sizeBytes 0), signs the POST policy
completeFile({ fileId }, actor): Promise<UploadedFile>
  // reads the real bytes, rejects + cleans up oversize, extracts, returns the POST /api/files shape

// files/provider-delete.ts
deleteProviderFileReferences(file: ProviderReferencedFile): Promise<void>  // never throws; claude-only (expiresAt === null)
processDeleteRetries(): Promise<void>                          // runs at the end of sweepOrphanFiles
```

DB (`files`, migration `0015` + `0016`):

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | application UUIDv7 |
| `user_id` | `text` FK → `users.id` ON DELETE CASCADE | owner |
| `filename` / `media_type` | `text` | as uploaded (normalized media type) |
| `size_bytes` | `integer` | ≤ `maxFileBytes()` at write time |
| `storage_key` | `text` UNIQUE | `<userId>/<fileId>` |
| `extracted_text` | `text` NULL | extraction cache, written at upload |
| `extraction_status` | `file_extraction_status` enum (`none`/`ok`/`empty`/`failed`) | `none` = image, audio, video |
| `extraction_truncated` | `boolean` | true when text hit `MAX_EXTRACTED_CHARS` |
| `provider_references` | `jsonb` NOT NULL DEFAULT `'{}'` | `Record<providerConfigId, { reference, uploadedAt, expiresAt }>` — regenerable cache, merged per config |

`provider_configs.files_api_unsupported_at` (`timestamptz`, nullable) is the
negative cache for the Files API; it is cleared whenever `baseUrl`, the api key,
or `apiFormat` change.
| `created_at` / `updated_at` | `timestamptz` | `updated_at` refreshed by the extraction write |

`provider_file_delete_retries` (migration `0017`) is the transient queue for
provider-side deletes that failed with a retryable status: `id` PK,
`provider_config_id`, `provider_file_id`, `attempts`, `next_retry_at`,
`last_status`, `created_at`. Deliberately **no FK** to `provider_configs` — a
deleted config must not cascade the queue away; the retry then reports "config
gone" and abandons the entry.

### 3. Contracts

**`POST /api/files`** — `multipart/form-data`, field `file`.

```json
{ "id": "…", "url": "/api/files/<id>", "filename": "report.pdf",
  "mediaType": "application/pdf", "sizeBytes": 12345,
  "extraction": { "status": "ok", "truncated": false } }
```

**`GET /api/files/limits`** — authenticated; the client's only source of truth
for pre-upload checks (the limit is runtime config, not a compile-time
constant).

```json
{ "maxFileBytes": 20971520, "maxAttachmentsPerMessage": 5, "directUpload": false }
```

**`POST /api/files/presign`** / **`POST /api/files/complete`** — the direct
upload pair, present only when `S3_DIRECT_ACCESS` is on (404 otherwise).
presign body `{ filename, mediaType }` → `{ fileId, post: { url, fields } }`;
complete body `{ fileId }` → the same `UploadedFile` shape as `POST /api/files`.
Direct-mode clients call complete, so **complete (and presign) must run
`sweepOrphanFiles(actor)` best-effort** — in direct mode they are the only
uploads, and the sweep is what reclaims stale pending rows *and* drains the
provider-delete retry queue.

**`GET /api/files/[id]`** — with `S3_DIRECT_ACCESS` on, the ownership check
runs first (a foreign id still 404s and never earns a signed URL), then the
handler signs a 1 h presigned GET whose `ResponseContentType` /
`ResponseContentDisposition` overrides mirror the relay semantics below, and
answers **302** with `Cache-Control: private, max-age=300` (the redirect cache
must be far shorter than the signature lifetime). With the flag off — bytes;
`Content-Type` from the row (always a
whitelisted type, so `inline` cannot be talked into serving a document type);
`inline` for images, PDF, audio and video (the message's native player fetches
it), `attachment` for everything else; `Cache-Control: private, max-age=3600`;
`X-Content-Type-Options: nosniff`.

**`DELETE /api/files/[id]`** — 204 when unreferenced; `409 file.inUse` when a
persisted message part references it.

**Persisted file part** (`chatFilePartSchema`, shared by the request union and
`chatStoredPartSchema`):

```ts
{ type: "file", url: "/api/files/<id>", mediaType: string,
  filename?: string, sizeBytes?: number }
```

**Environment**: storage backend is selected by env. With no `S3_*`
variables, `FILE_STORAGE_DIR` (optional, default `.data/files`) selects local
disk and the production compose file must mount a persistent volume there.
Setting `S3_BUCKET` switches to S3-compatible object storage (`S3_ENDPOINT`, `S3_REGION` default `us-east-1`, `S3_ACCESS_KEY_ID` /
`S3_SECRET_ACCESS_KEY`); a custom `S3_ENDPOINT` automatically switches
requests to path-style URLs, which is what MinIO/RustFS-style endpoints on a
container network require. The bucket is created lazily on first use. A bucket without credentials
fails at server boot via `src/instrumentation.ts`, not on the first upload.
`docker-compose.prod.rustfs.yml` is an override that adds a rustfs service
and wires the app's `S3_*` vars to it; its credentials come from the same
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` the app reads.

Upload limits are env-wired too: `FILE_UPLOAD_MAX_MB` (integer 1–100, unset →
20 MiB; an out-of-range value fails at boot via the env schema) and
`S3_DIRECT_ACCESS` (`1`/`true`, unset → server-side relay for both upload and
download). Setting
`S3_DIRECT_ACCESS` without `S3_BUCKET` fails at boot — local disk has no
direct-access path, and silently falling back would make one env mean two
different things depending on the deployment. When on, clients talk to S3
directly in both directions: presigned POST for upload (needs bucket CORS
allowing browser POSTs) and a 302 to a presigned GET for download/preview
(no CORS needed — redirects and media elements are not CORS-gated).

**Model payload rewrite** (`resolveAttachmentsForModel`):

| Category | Model advertises | Payload |
|---|---|---|
| image | `image` | file part kept, bytes read from storage as `data:<mediaType>;base64,…` |
| image | — | `file.imageRequiresVision` |
| pdf | `pdf` | native data URL (as above) |
| pdf | — | cached text wrapped as a text part |
| office (docx/xlsx/pptx) | — (always) | cached text wrapped as a text part |
| ebook (epub) | — (always) | cached text wrapped as a text part |
| text (txt/md/csv/code) | — (always) | cached text wrapped as a text part |
| audio / video | the modality **and** the api format can serialize that media type | file part kept; a provider Files API reference when one resolves (google/claude), else `data:…;base64,…` |
| audio / video | either gate fails | `file.mediaUnsupported` |

Wrapped text is `<attachment filename="…" truncated="true|false">\n…\n</attachment>`.

Native parts on a reference keep `url: /api/files/<id>` (the UI card still
renders) and add `providerReference`; the SDK prefers the reference over the
url. `openai-compatible` has no Files API, so it always inlines. Never extracted
for audio/video: there is no transcription path, so an unsupported media file is
a hard error, not a degraded text part.

### 4. Validation & Error Matrix

| Condition | code | status | messageKey |
|---|---|---|---|
| file > `maxFileBytes()` (`FILE_UPLOAD_MAX_MB`, default 20 MiB) | `VALIDATION_FAILED` | 400 | `file.tooLarge` (`{limit}`) |
| direct upload off + presign/complete called | `NOT_FOUND` | 404 | `file.notFound` |
| direct upload never landed (object missing at complete) | `NOT_FOUND` | 404 | `file.uploadFailed` |
| direct upload landed larger than the limit (policy bypassed) | `VALIDATION_FAILED` | 400 | `file.tooLarge` (`{limit}`), object **and** row removed |
| unsupported media type / no file field | `VALIDATION_FAILED` | 400 | `file.unsupportedType` |
| > `MAX_ATTACHMENTS_PER_MESSAGE` (5) | `VALIDATION_FAILED` | 400 | `file.tooMany` (`{max}`) |
| foreign or missing file id | `NOT_FOUND` | 404 | `file.notFound` |
| scanned PDF + model cannot consume pdf | `VALIDATION_FAILED` | 400 | `file.noTextLayer` |
| corrupt / encrypted file | `VALIDATION_FAILED` | 400 | `file.unreadable` |
| image + model without `image` modality | `VALIDATION_FAILED` | 400 | `file.imageRequiresVision` |
| audio/video the model does not declare, or the api format cannot serialize | `VALIDATION_FAILED` | 400 | `file.mediaUnsupported` |
| delete of a referenced file | `CONFLICT` | 409 | `file.inUse` |

### 5. Good / Base / Bad Cases

- **Good**: text-layer PDF + model advertising `pdf` → single native file part,
  no extraction work reaches the prompt.
- **Base**: docx + text-only model → cached extraction injected as one wrapped
  text part; the same message replayed to a vision/PDF-capable model next turn
  routes natively instead.
- **Bad**: `appendUserMessage` before `resolveAttachmentsForModel`. The turn
  fails with `file.noTextLayer` *after* the message is stored, so every later
  send replays the unusable attachment and 400s the topic. Resolve first,
  persist second.

### 6. Tests Required

- `extract/*` unit + fixtures: text-layer PDF, scanned PDF (`empty`), encrypted
  PDF (`failed`), docx with a table (assert a GFM `| --- |` row), xlsx (CSV per
  sheet), text truncation flag.
- `attachments.test.ts`: four categories × advertised/not-advertised matrix;
  assert the input messages are not mutated; `empty` only raises
  `file.noTextLayer` for pdf/office (an empty `.txt` passes through).
- `file.service.integration.test.ts` (real DB): byte round-trip, foreign id →
  `NOT_FOUND`, referenced delete → `CONFLICT`, cascade on message/topic delete,
  24 h orphan sweep preserving referenced files.
- `api/chat/route.test.ts`: attachment resolution failure leaves neither a user
  message nor a new topic.
- `MessageItem.test.tsx`: card renders filename + size; missing `sizeBytes`
  renders without a size (old rows).

### 7. Wrong vs Correct

#### Wrong

```ts
// Handing the provider our own authenticated URL: it cannot reach the
// instance, and a server-side self-fetch still needs the session cookie.
const parts = messages.flatMap((m) => m.parts); // url: "/api/files/<id>"
```

#### Correct

```ts
// Read bytes through the storage abstraction and inline them as a data URL.
const row = await getFileForActor(fileId, actor);
const dataUrl = `data:${row.mediaType};base64,${(await getFileStorage().get(row.storageKey)).toString("base64")}`;
```

#### Wrong

```ts
// Persisting raw extractor output: pdf.js emits NUL bytes for some embedded
// fonts (math glyphs), and Postgres `text` columns reject 0x00 — the
// extraction-cache UPDATE fails with `invalid byte sequence for encoding
// "UTF8"` and the row is left as a status=none orphan.
await db.update(files).set({ extractedText: result.text });
```

#### Correct

```ts
// The dispatcher strips NUL, the other C0 controls (except \t \n \r) and DEL
// from every extractor's output, so the service only ever sees storable text.
return { ...result, text: sanitizeExtractedText(result.text) };
```

---

## Scenario: S3 direct access and provider-side file cleanup

### 1. Scope / Trigger

Two cross-layer contracts added on top of the relay upload path: an env-wired
size limit plus optional S3 presigned direct upload, and automatic deletion of
provider-side (Anthropic Files API) copies when the local attachment goes away.
Both change request/response contracts and infrastructure wiring, so they carry
full code-spec depth.

### 2. Signatures

See the `limits.ts` / `storage.ts` / `provider-delete.ts` entries in section 2
above. The direct pair is `presignFile` + `completeFile` behind
`POST /api/files/presign` and `POST /api/files/complete`.

### 3. Contracts

- **Two size gates.** The presigned POST policy carries
  `["content-length-range", 1, maxBytes]` (S3 rejects oversize bodies), and
  `completeFile` re-checks the **actual** bytes read through `storage.get`
  before the row is finalized. Never trust a client-reported size.
- **Downloads redirect, they don't proxy.** With the flag on, `GET /api/files/[id]`
  verifies ownership (404 for foreign ids, before any signing), then 302s to a
  1 h presigned GET whose `ResponseContentType`/`ResponseContentDisposition`
  overrides reproduce the relay headers exactly. The redirect itself is cached
  for 5 min at most so a stale redirect never outlives its signature.
- **Pending rows.** presign inserts the row up front (`sizeBytes = 0`,
  `extractionStatus = "none"`) so an unfinished direct upload is reclaimable by
the existing 24 h orphan sweep — no S3 list-and-diff mechanism.
- **Cleanup order on oversize.** Delete the object first, then the row, so a
  failed object delete leaves the row for the sweep to retry. Same rule as
  `deleteFile`.
- **Provider delete linkage.** `deleteFile`, `deleteFilesIfUnreferenced` and
  `sweepOrphanFiles` call `deleteProviderFileReferences` after the local delete.
  Only references with `expiresAt === null` (Anthropic; Gemini expires in 48 h
  on its own) are deleted, via
  `DELETE {baseUrl}/files/{id}` (`baseUrl` already ends in `/v1`; appending
  `/v1` again yields `/v1/v1/files`).
- **Bounded retry.** 2xx/404 resolve, 401/403 or a missing/format-changed
  config abandon, 429/5xx/network enqueue. The queue is drained only by the
  sweep, with backoff 1 h → 4 h → 12 h → 24 h → 48 h and hard stop after 5
  attempts.
- **Never reconcile the whole account.** No `GET /v1/files` diff-festival: the
  system only deletes ids it recorded itself. This is also why a shared API key
  cannot take out another application's files.
- **Zero-call invariant.** No provider reference → no API call; empty retry
  queue → no API call.

### 4. Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| `FILE_UPLOAD_MAX_MB` > 100 / < 1 / non-integer | boot fails (env schema) |
| `S3_DIRECT_ACCESS` set without `S3_BUCKET` | boot fails in `instrumentation.register()` |
| presign/complete with direct off | 404 `file.notFound` |
| complete, object missing | 404 `file.uploadFailed` (pending row stays for the sweep) |
| complete, real size > limit | 400 `file.tooLarge`, object + row removed |
| provider delete: 2xx/404 | resolved, queue entry dropped |
| provider delete: 401/403 | abandoned + warn (retrying cannot help) |
| provider delete: 429/5xx/network | queued, retried on the next sweep, 5 attempts max |
| provider delete: config deleted or format changed | abandoned + warn |

### 5. Good / Base / Bad Cases

- **Good**: `S3_DIRECT_ACCESS=1` + S3 → composer presigns, the browser POSTs
  the file straight to the bucket, complete records the real size and returns
  the cached extraction, preview/download is a 302 the browser follows to S3,
  and a later delete removes the local object plus the
  Anthropic copy in one turn.
- **Base**: env defaults → relay upload, 20 MiB limit, no presign endpoints, no
  provider deletes for Gemini references.
- **Bad**: hooking the orphan sweep only into the relay route. With direct
  upload on, that route is never called, so pending rows accumulate forever and
  the retry queue never drains.

### 6. Tests Required

- `env.test.ts` / `limits.test.ts`: boundaries 1/100/101/0/non-numeric, default
  20 MiB, direct-on requires S3.
- `file.service.direct.integration.test.ts`: presign → direct POST → complete
  round-trip, real-size oversize cleanup (object **and** row gone), missing
  object 404, stale pending row reclaimed by a completion-triggered sweep while
  a fresh pending row survives.
- `presign/route.test.ts` / `complete/route.test.ts`: 404 when direct is off,
  `sweepOrphanFiles(actor)` called on success and not on failure paths.
- `provider-delete.test.ts`: category matrix (gemini skipped, 2xx/404 resolve,
  401/403 abandon, 429/5xx queue), backoff sequence, 5-attempt ceiling, missing
  config, and the empty-queue zero-call case.
- `provider-delete.integration.test.ts`: each of the three local delete paths
  triggers exactly one provider DELETE; a due queue entry is drained.

### 7. Wrong vs Correct

#### Wrong

```ts
// Only the relay route sweeps, so direct-mode uploads never reclaim anything.
// src/app/api/files/route.ts (relay POST) — the sole sweepOrphanFiles caller
await sweepOrphanFiles(actor);
```

#### Correct

```ts
// complete/presign are the direct-mode uploads; they must sweep too.
// src/app/api/files/complete/route.ts
const file = await completeFile({ fileId }, actor);
await sweepOrphanFiles(actor);   // best-effort: reclaims stale pending rows + drains retries
return Response.json(file, { status: 201 });
```

#### Wrong

```ts
// Trusting the client's declared size on a direct upload.
await db.update(files).set({ sizeBytes: input.sizeBytes });
```

#### Correct

```ts
const data = await getFileStorage().get(file.storageKey);   // actual bytes
if (data.byteLength > maxFileBytes()) {
  await getFileStorage().delete(file.storageKey);           // object first
  await db.delete(files).where(eq(files.id, file.id));      // then the row
  throw new AppError("VALIDATION_FAILED", 400, "file.tooLarge", { limit: formatBytes(maxFileBytes()) });
}
```

---

### Common Mistakes

- **Extracting images.** Images never enter the extractor; they are transmitted
  natively or rejected. `extractDocument` throws on an image by design.
- **Trusting the client's file part.** Canonicalize `url`/`mediaType`/`filename`
  from the `files` row; the client declaration is not evidence.
- **Trusting the row's owner for a batch read.** `getFilesByIds` does not filter
  by owner; only feed it ids that an actor-scoped query already authorized.
- **Deleting a file row before its storage object.** A failed object delete
  must leave the row so the delete can be retried; a row pointing at missing
  bytes is the worse failure.
- **Counted rejected chips.** Only staged entries that will upload occupy one of
  the five slots — share one slot-count helper between the picker's disabled
  state and `addFiles`.
- **Assuming only `POST /api/files` uploads.** With `S3_DIRECT_ACCESS` on, the
  composer never calls it — presign/complete are the upload path, and the sweep
  (pending-row reclamation + provider-delete retries) rides on them.
- **Treating `sizeBytes === 0` as "not ready".** A legitimately empty file (a
  0-byte `.txt`) is sendable — the spec allows an `empty` extraction to pass
  through — so the send path must not use size as a readiness flag.
- **Appending `/v1` to a provider `baseUrl`.** It already ends in the version
  segment (`.../v1`); `{baseUrl}/files/{id}` is correct, `{baseUrl}/v1/files/{id}`
  is not.
- **Reaching for `createPresignedPost` in `@aws-sdk/s3-request-presigner`.**
  That package only exports `getSignedUrl`; the POST-policy helper lives in
  `@aws-sdk/s3-presigned-post`.

### Design Decisions

**Extract at upload, not at send.** Extraction errors and the truncation flag
surface on the composer chip before the turn is sent, and the send path becomes
a cache read. The cost is one wasted parse for a PDF that only ever goes to a
native-pdf model.

**Runtime upload limit, env-wired.** The 20 MiB ceiling is now
`FILE_UPLOAD_MAX_MB` (1–100, default 20). It is server config, so the client
learns it from `GET /api/files/limits` instead of a compile-time constant, and
falls back to 20 MiB if that call fails. Tightening it never invalidates
already-stored files.

**Direct access is opt-in, S3-only, and bidirectional.** `S3_DIRECT_ACCESS`
defaults off; the relay path stays the default because it works with local disk
and needs no bucket CORS. One flag covers both presigned-POST upload and the
302 presigned-GET download: they are the same "clients exchange bytes with S3
directly" semantic, and splitting them would create a 2×2 matrix where half
the combinations are pointless. The download redirect keeps the ownership
check on the request path — a foreign id never earns a signed URL — while the
bearer-URL window is bounded by a 1 h signature and a 5 min redirect cache.

**Presign inserts the row, so orphan mechanics stay unchanged.** Writing the
pending row at presign time lets the existing 24 h sweep own unfinished
uploads, avoiding a second reclamation mechanism (S3 list-and-diff). The trade
is that `sizeBytes` cannot be a readiness flag.

**Provider cleanup is event-driven, never a reconciliation UI.** Deletes are
recorded per reference and retried in a bounded loop; there is no admin
"reconcile with Anthropic" screen. It costs an operator nothing and cannot
mis-delete files under a shared API key — the only ids touched are ones this
app uploaded and recorded.

**Local disk with an interface seam.** `FileStorage` keeps the S3 implementation
a drop-in swap. `Buffer` at a 20 MiB ceiling keeps the local implementation
small; streaming belongs to the S3 work.

**Native `data:` URLs instead of provider file APIs.** The provider cannot reach
`/api/files/<id>`, and a self-fetch would need the request's credentials. The
Files API (`uploadFile` + `providerReference`) is the planned second-phase
optimization for re-transmission cost, not a correctness requirement.
