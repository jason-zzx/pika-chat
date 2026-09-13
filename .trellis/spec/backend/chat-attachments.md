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
src/server/files/file.service.ts   upload/get/delete/cascade/orphan sweep
src/server/files/extract/          extractDocument() media-type dispatcher
src/server/ai/attachments.ts       resolveAttachmentsForModel()
src/lib/files/                     isomorphic media-type table + limits
src/app/api/files/route.ts         POST
src/app/api/files/[id]/route.ts    GET / DELETE
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
```

DB (`files`, migration `0015` + `0016`):

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | application UUIDv7 |
| `user_id` | `text` FK → `users.id` ON DELETE CASCADE | owner |
| `filename` / `media_type` | `text` | as uploaded (normalized media type) |
| `size_bytes` | `integer` | ≤ `MAX_FILE_BYTES` |
| `storage_key` | `text` UNIQUE | `<userId>/<fileId>` |
| `extracted_text` | `text` NULL | extraction cache, written at upload |
| `extraction_status` | `file_extraction_status` enum (`none`/`ok`/`empty`/`failed`) | `none` = image, audio, video |
| `extraction_truncated` | `boolean` | true when text hit `MAX_EXTRACTED_CHARS` |
| `provider_references` | `jsonb` NOT NULL DEFAULT `'{}'` | `Record<providerConfigId, { reference, uploadedAt, expiresAt }>` — regenerable cache, merged per config |

`provider_configs.files_api_unsupported_at` (`timestamptz`, nullable) is the
negative cache for the Files API; it is cleared whenever `baseUrl`, the api key,
or `apiFormat` change.
| `created_at` / `updated_at` | `timestamptz` | `updated_at` refreshed by the extraction write |

### 3. Contracts

**`POST /api/files`** — `multipart/form-data`, field `file`.

```json
{ "id": "…", "url": "/api/files/<id>", "filename": "report.pdf",
  "mediaType": "application/pdf", "sizeBytes": 12345,
  "extraction": { "status": "ok", "truncated": false } }
```

**`GET /api/files/[id]`** — bytes; `Content-Type` from the row (always a
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
| file > `MAX_FILE_BYTES` (20 MiB) | `VALIDATION_FAILED` | 400 | `file.tooLarge` (`{limit}`) |
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

### Design Decisions

**Extract at upload, not at send.** Extraction errors and the truncation flag
surface on the composer chip before the turn is sent, and the send path becomes
a cache read. The cost is one wasted parse for a PDF that only ever goes to a
native-pdf model.

**Local disk with an interface seam.** `FileStorage` keeps the S3 implementation
a drop-in swap. `Buffer` at a 20 MiB ceiling keeps the local implementation
small; streaming belongs to the S3 work.

**Native `data:` URLs instead of provider file APIs.** The provider cannot reach
`/api/files/<id>`, and a self-fetch would need the request's credentials. The
Files API (`uploadFile` + `providerReference`) is the planned second-phase
optimization for re-transmission cost, not a correctness requirement.
