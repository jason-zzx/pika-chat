import "server-only";

import {
  and,
  desc,
  eq,
  inArray,
  like,
  lt,
  not,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import {
  FILE_LIST_MAX_LIMIT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/files/constants";
import { formatBytes } from "@/lib/files/format";
import {
  AUDIO_FILE_EXTENSIONS,
  AUDIO_MEDIA_TYPES,
  avMediaTypeForExtension,
  CLASSIFIED_MEDIA_TYPES,
  classifyFile,
  EBOOK_FILE_EXTENSIONS,
  EPUB_MEDIA_TYPE,
  type FileCategory,
  fileExtension,
  type FileListCategory,
  FILE_URL_PREFIX,
  IMAGE_MEDIA_TYPES,
  normalizeMediaType,
  OFFICE_FILE_EXTENSIONS,
  OFFICE_MEDIA_TYPES,
  PDF_MEDIA_TYPE,
  TEXT_FILE_EXTENSIONS,
  TEXT_FILE_NAMES,
  VIDEO_FILE_EXTENSIONS,
  VIDEO_MEDIA_TYPES,
} from "@/lib/files/media-types";
import { newId } from "@/lib/id";
import type { ChatFilePart } from "@/lib/schemas/chat";
import type {
  FileExtractionState,
  FileListResponse,
  PresignedUpload,
} from "@/lib/schemas/file";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { chatMessages, files } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

import { extractDocument } from "./extract";
import { maxFileBytes } from "./limits";
import {
  deleteProviderFileReferences,
  processDeleteRetries,
} from "./provider-delete";
import { assertUploadQuota, quotaExceededError, usageBytes } from "./quota";
import { getFileStorage, type FileStorage } from "./storage";

/** Persisted attachment row, including the extraction cache. */
export type FileRecord = typeof files.$inferSelect;

export type { FileExtractionState };

/** Wire shape of an upload response. */
export type UploadedFile = {
  id: string;
  url: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  extraction: { status: FileExtractionState; truncated: boolean };
};

/**
 * Storage key for a *new* attachment: `<userId>/<fileId>.<ext>`. The extension
 * comes from the original filename — lowercased, restricted to `[a-z0-9]`,
 * capped at 10 chars — and exists only so objects are recognizable in an
 * S3/RustFS console. It is never trusted for behaviour: the row's media_type
 * stays the source of truth for Content-Type, and `assertValidStorageKey`
 * accepts a dotted segment. Rows written before this layout keep their
 * extension-less keys forever (the column is the truth on read).
 */
export function storageKeyFor(
  userId: string,
  fileId: string,
  filename: string,
): string {
  const extension = fileExtension(filename)
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
  return extension.length > 0
    ? `${userId}/${fileId}.${extension}`
    : `${userId}/${fileId}`;
}

/** Attachments unreferenced for this long are reclaimable by the sweeper. */
export const ORPHAN_FILE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Presigned POST lifetime. Long enough for a slow mobile upload at the
 * configured ceiling, short enough that a leaked policy is not a lasting
 * grant. The row it produced lives on until `completeFile` or the 24h sweep.
 */
export const PRESIGN_EXPIRES_SEC = 900;

export function fileUrl(fileId: string): string {
  return `${FILE_URL_PREFIX}${fileId}`;
}

/**
 * Extracts attachment ids from persisted message parts. Reads raw jsonb rather
 * than the parsed schema so a file part written by a newer deploy is still
 * reclaimable after a rollback.
 */
export function fileIdsFromParts(parts: unknown): string[] {
  if (!Array.isArray(parts)) {
    return [];
  }
  const ids = new Set<string>();
  for (const part of parts) {
    if (typeof part !== "object" || part === null) {
      continue;
    }
    const record = part as Record<string, unknown>;
    if (record.type !== "file" || typeof record.url !== "string") {
      continue;
    }
    if (
      record.url.startsWith(FILE_URL_PREFIX) &&
      record.url.length > FILE_URL_PREFIX.length
    ) {
      ids.add(record.url.slice(FILE_URL_PREFIX.length));
    }
  }
  return [...ids];
}

/** Placeholder browsers send for content they cannot sniff. It says nothing. */
const GENERIC_BINARY_MEDIA_TYPE = "application/octet-stream";

/**
 * Media type to persist. Browsers send `""` for many code/text files, which
 * still classify by extension — this gives those a truthful stored type so the
 * download response and the native-transmission path are not octet-stream.
 */
function storedMediaType(declared: string, filename: string): string {
  const normalized = normalizeMediaType(declared);
  // Audio/video first, for an empty *or* generic declared type: several mobile
  // pickers report `application/octet-stream` for media. `classifyFile` still
  // routes those by extension, so persisting the placeholder would let the
  // upload through and then fail every send on a type no endpoint can
  // serialize.
  if (
    normalized.length === 0 ||
    normalized === GENERIC_BINARY_MEDIA_TYPE
  ) {
    const avMediaType = avMediaTypeForExtension(filename);
    if (avMediaType !== null) {
      return avMediaType;
    }
  }
  if (normalized.length > 0) {
    return normalized;
  }
  switch (fileExtension(filename)) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "csv":
      return "text/csv";
    case "tsv":
      return "text/tab-separated-values";
    case "json":
    case "jsonc":
      return "application/json";
    case "html":
    case "htm":
      return "text/html";
    case "css":
      return "text/css";
    default:
      return "text/plain";
  }
}

/** Deletes a stored object, logging rather than throwing — callers are
 * best-effort cleanup paths where a failure must not mask the real outcome. */
async function removeObjectQuietly(
  storageKey: string,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await getFileStorage().delete(storageKey);
  } catch (error) {
    logger.warn({ err: error, ...context }, "failed to delete stored attachment");
  }
}

/**
 * True when a storage read failed because the object is absent — a direct
 * upload that never landed, or one whose policy expired. Only reachable with
 * direct access on, i.e. against S3: it raises NoSuchKey, and implementations
 * disagree on the error name, so the HTTP status is consulted as a fallback.
 */
function isObjectMissing(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "NoSuchKey" || error.name === "NotFound") {
    return true;
  }
  const metadata =
    "$metadata" in error
      ? (error as { $metadata?: unknown }).$metadata
      : undefined;
  if (typeof metadata !== "object" || metadata === null) {
    return false;
  }
  return (
    "httpStatusCode" in metadata && metadata.httpStatusCode === 404
  );
}

/**
 * Removes a direct upload rejected at {@link completeFile} — the object first,
 * then the row, so a failed object delete leaves the row for the orphan sweep
 * to retry instead of a row pointing at nothing.
 */
async function discardRejectedDirectUpload(
  storage: FileStorage,
  storageKey: string,
  fileId: string,
): Promise<void> {
  await storage.delete(storageKey);
  await getDb().delete(files).where(eq(files.id, fileId));
}

/**
 * Runs extraction and caches the outcome on the row. A corrupt or encrypted
 * file is recorded as `failed` instead of failing the upload — the send path
 * turns that into a user-visible `file.unreadable`.
 */
async function extractAndCache(
  fileId: string,
  category: FileCategory,
  mediaType: string,
  filename: string,
  data: Buffer,
  userId: string,
): Promise<{ status: FileExtractionState; truncated: boolean }> {
  // Images are transmitted natively or rejected, never extracted. Audio and
  // video are the same in the other direction: they are only ever sent as
  // bytes to a model that declares the modality, and there is no
  // transcription service to fall back on, so `none` is their resting state.
  if (category === "image" || category === "audio" || category === "video") {
    return { status: "none", truncated: false };
  }

  let status: FileExtractionState = "failed";
  let text: string | null = null;
  let truncated = false;
  try {
    const result = await extractDocument(data, mediaType, filename);
    status = result.status;
    text = result.text.length > 0 ? result.text : null;
    truncated = result.truncated;
  } catch (error) {
    // extractDocument only throws on an unsupported branch; treat it like the
    // `failed` result it would otherwise return.
    logger.error(
      { err: error, userId, fileId, mediaType },
      "attachment extraction threw",
    );
  }

  await getDb()
    .update(files)
    .set({
      extractedText: text,
      extractionStatus: status,
      extractionTruncated: truncated,
      updatedAt: new Date(),
    })
    .where(eq(files.id, fileId));

  return { status, truncated };
}

export async function uploadFile(
  input: { filename: string; mediaType: string; data: Buffer },
  actor: Actor,
): Promise<UploadedFile> {
  const filename = input.filename.trim().length > 0 ? input.filename : "file";
  const category = classifyFile({ mediaType: input.mediaType, filename });
  if (!category) {
    throw new AppError("VALIDATION_FAILED", 400, "file.unsupportedType");
  }
  const sizeBytes = input.data.byteLength;
  const limitBytes = maxFileBytes();
  if (sizeBytes > limitBytes) {
    throw new AppError("VALIDATION_FAILED", 400, "file.tooLarge", {
      limit: formatBytes(limitBytes),
    });
  }
  // Checked before the bytes reach storage, so a rejected upload leaves no
  // object behind (and no row, which is only written after the put).
  await assertUploadQuota(actor, sizeBytes);

  const mediaType = storedMediaType(input.mediaType, filename);
  const id = newId();
  const storageKey = storageKeyFor(actor.userId, id, filename);
  const storage = getFileStorage();
  await storage.put(storageKey, input.data);

  // The row is written before extraction so every stored object has a row the
  // orphan sweeper can find if this request dies mid-parse.
  let inserted;
  try {
    inserted = await getDb()
      .insert(files)
      .values({
        id,
        userId: actor.userId,
        filename,
        mediaType,
        sizeBytes,
        storageKey,
      })
      .returning();
  } catch (error) {
    await removeObjectQuietly(storageKey, {
      userId: actor.userId,
      fileId: id,
    });
    throw error;
  }

  const row = inserted[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "file.uploadFailed");
  }

  const extraction = await extractAndCache(
    id,
    category,
    mediaType,
    filename,
    input.data,
    actor.userId,
  );

  logger.info(
    { userId: actor.userId, fileId: id, mediaType, sizeBytes },
    "attachment uploaded",
  );

  return {
    id,
    url: fileUrl(id),
    filename,
    mediaType,
    sizeBytes,
    extraction,
  };
}

/**
 * Starts a direct browser→storage upload. Validates the declared type up front
 * (the same whitelist the relay path uses) and writes a *pending* row before
 * signing: `sizeBytes = 0` until {@link completeFile} reads the object back.
 * An abandoned direct upload is therefore just an orphan the existing 24h
 * sweep reclaims — no S3-side reconciliation is needed.
 *
 * Storage quota is deliberately *not* checked here: presign has no real size
 * to measure. The single quota gate for this path is {@link completeFile},
 * which reads the object's actual bytes before finalizing the row.
 */
export async function presignFile(
  input: { filename: string; mediaType: string },
  actor: Actor,
): Promise<PresignedUpload> {
  const filename = input.filename.trim().length > 0 ? input.filename : "file";
  const category = classifyFile({ mediaType: input.mediaType, filename });
  if (!category) {
    throw new AppError("VALIDATION_FAILED", 400, "file.unsupportedType");
  }

  const storage = getFileStorage();
  const mediaType = storedMediaType(input.mediaType, filename);
  const id = newId();
  const storageKey = storageKeyFor(actor.userId, id, filename);
  await getDb().insert(files).values({
    id,
    userId: actor.userId,
    filename,
    mediaType,
    sizeBytes: 0,
    storageKey,
  });

  // Optional in the interface because local disk cannot sign; the presign
  // route only runs with direct access on, which boot guarantees is S3.
  const post = await storage.createPresignedPost!(storageKey, {
    maxBytes: maxFileBytes(),
    expiresSec: PRESIGN_EXPIRES_SEC,
  });

  logger.info(
    { userId: actor.userId, fileId: id, mediaType },
    "attachment upload presigned",
  );

  return { fileId: id, post };
}

/**
 * Finalizes a direct upload. The object's real size is read back from storage
 * and re-checked against the configured limit — the policy's
 * `content-length-range` is the first gate, not the only one, and a
 * client-reported size is never trusted. Extraction then runs here so the
 * composer chip shows its parse state exactly as on the relay path.
 */
export async function completeFile(
  fileId: string,
  actor: Actor,
): Promise<UploadedFile> {
  const file = await getFileForActor(fileId, actor);
  const storage = getFileStorage();

  let data: Buffer;
  try {
    data = await storage.get(file.storageKey);
  } catch (error) {
    if (isObjectMissing(error)) {
      // The pending row exists but no object landed behind it. A re-upload is
      // possible until the orphan sweep reclaims the row.
      throw new AppError("NOT_FOUND", 404, "file.uploadFailed");
    }
    throw error;
  }

  const sizeBytes = data.byteLength;
  const limitBytes = maxFileBytes();
  // Both gates share one rejection path: the object is deleted before the row
  // so a failed object delete leaves the row for the orphan sweep to retry.
  const rejection =
    sizeBytes > limitBytes
      ? new AppError("VALIDATION_FAILED", 400, "file.tooLarge", {
          limit: formatBytes(limitBytes),
        })
      : await quotaExceededError(actor, sizeBytes);
  if (rejection) {
    await discardRejectedDirectUpload(storage, file.storageKey, fileId);
    throw rejection;
  }

  await getDb()
    .update(files)
    .set({ sizeBytes, updatedAt: new Date() })
    .where(eq(files.id, fileId));

  // `!`: presign classified the same filename + stored media type pair
  // before signing, and `storedMediaType` only narrows toward classifiable.
  const category = classifyFile({
    mediaType: file.mediaType,
    filename: file.filename,
  })!;

  const extraction = await extractAndCache(
    fileId,
    category,
    file.mediaType,
    file.filename,
    data,
    actor.userId,
  );

  logger.info(
    { userId: actor.userId, fileId, mediaType: file.mediaType, sizeBytes },
    "attachment direct upload completed",
  );

  return {
    id: fileId,
    url: fileUrl(fileId),
    filename: file.filename,
    mediaType: file.mediaType,
    sizeBytes,
    extraction,
  };
}

/**
 * Batch owned-row lookup, keyed by id. A key that is absent means the row is
 * missing or belongs to someone else — deliberately indistinguishable.
 */
export async function getFilesForActor(
  ids: string[],
  actor: Actor,
): Promise<Map<string, FileRecord>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await getDb()
    .select()
    .from(files)
    .where(and(eq(files.userId, actor.userId), inArray(files.id, unique)));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Owned-row lookup. A foreign id is indistinguishable from a missing one on
 * purpose — otherwise the endpoint becomes an existence oracle.
 */
export async function getFileForActor(
  id: string,
  actor: Actor,
): Promise<FileRecord> {
  const row = (await getFilesForActor([id], actor)).get(id);
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "file.notFound");
  }
  return row;
}

/**
 * Batch lookup by id without an ownership filter, for the send-path attachment
 * router: one turn replays many file parts and must not fan out into N
 * queries. Callers must have authorized the ids first — they come from the
 * actor's own message history or from {@link resolveOwnedFileParts}.
 */
export async function getFilesByIds(
  ids: string[],
): Promise<Map<string, FileRecord>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await getDb()
    .select()
    .from(files)
    .where(inArray(files.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Validates the attachment parts of an incoming user message against the
 * stored rows and canonicalizes them: the client's declared mediaType and
 * filename are discarded in favour of what was actually uploaded, and the url
 * is rewritten to its canonical form. Ownership is enforced here, so a part
 * referencing a foreign or missing file is NOT_FOUND (not FORBIDDEN).
 */
export async function resolveOwnedFileParts(
  parts: ChatFilePart[],
  actor: Actor,
): Promise<ChatFilePart[]> {
  if (parts.length === 0) {
    return [];
  }
  if (parts.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AppError("VALIDATION_FAILED", 400, "file.tooMany", {
      max: MAX_ATTACHMENTS_PER_MESSAGE,
    });
  }
  const ids = parts.map((part) => part.url.slice(FILE_URL_PREFIX.length));
  const rows = await getFilesForActor(ids, actor);
  return parts.map((part) => {
    const id = part.url.slice(FILE_URL_PREFIX.length);
    const row = rows.get(id);
    if (!row) {
      throw new AppError("NOT_FOUND", 404, "file.notFound");
    }
    // A declared type that disagrees with the stored row is a forged part, not
    // a file we are willing to route to a model.
    if (normalizeMediaType(part.mediaType) !== row.mediaType) {
      throw new AppError("VALIDATION_FAILED", 400, "file.unsupportedType");
    }
    return {
      type: "file" as const,
      url: fileUrl(row.id),
      mediaType: row.mediaType,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
    };
  });
}

/**
 * The one definition of "a message part references this file": jsonb
 * containment of `{ url: "/api/files/<id>" }` against a message's `parts`.
 * The list's in-use badge, {@link isFileReferenced} and the orphan sweep all
 * build on it, so the three cannot disagree about what a reference is.
 */
function messageReferencesFileSql(
  parts: SQLWrapper,
  fileId: SQLWrapper,
): SQL<boolean> {
  return sql<boolean>`${parts} @> jsonb_build_array(
    jsonb_build_object('url', ${FILE_URL_PREFIX} || ${fileId})
  )`;
}

/**
 * EXISTS over `chat_messages` for the list's in-use badge: true when a
 * persisted message still points at this row's file id. Interpolating
 * `files.id` renders it qualified in the select list, matching the sweeper's
 * predicate.
 */
function referencedByMessageSql(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from chat_messages cm
    where ${messageReferencesFileSql(sql`cm.parts`, files.id)}
  )`;
}

/** Basename of a stored filename, mirroring `basename()` in media-types.ts. */
const FILENAME_BASENAME_PATTERN = "^.*[/\\\\]";
/** Last dotted segment, applied only once the basename has a non-leading dot. */
const FILENAME_EXTENSION_PATTERN = "^.*\\.";

/** Lowercased, path-less filename of the current row. */
function basenameSql(): SQL<string> {
  return sql<string>`lower(regexp_replace(${files.filename}, ${FILENAME_BASENAME_PATTERN}, ''))`;
}

/**
 * Lowercased extension of the current row's filename, mirroring
 * `fileExtension()`: empty when there is no dot or when the only dot starts the
 * name (a dotfile like `.gitignore` has no extension).
 */
function extensionSql(): SQL<string> {
  const base = basenameSql();
  return sql<string>`case
    when strpos(substr(${base}, 2), '.') > 0
      then regexp_replace(${base}, ${FILENAME_EXTENSION_PATTERN}, '')
    else ''
  end`;
}

/**
 * `mediaType`/extension predicate for one coarse list category, mirroring
 * `fileListCategoryOf` → `classifyFile` exactly: a recognized media type wins,
 * and only an unclassified type falls through to the extension rules in the
 * same order (office/ebook extension, then audio/video extension, then text).
 * Every table it reads is exported from `@/lib/files/media-types`, so a row's
 * badge and its filter membership cannot drift.
 */
function categoryCondition(category: FileListCategory): SQL {
  const typeIn = (types: readonly string[]) =>
    inArray(files.mediaType, [...types]);
  const classified = typeIn(CLASSIFIED_MEDIA_TYPES);
  const notClassified = not(classified);
  const extensionIn = (extensions: readonly string[]) =>
    inArray(extensionSql(), [...extensions]);
  // Extension rules only apply to a row whose media type classified nothing.
  const byExtension = (condition: SQL | undefined) =>
    and(notClassified, condition);

  if (category === "image") {
    return typeIn(IMAGE_MEDIA_TYPES);
  }

  const avAudio = extensionIn(AUDIO_FILE_EXTENSIONS);
  const avVideo = extensionIn(VIDEO_FILE_EXTENSIONS);

  if (category === "audio") {
    return or(typeIn(AUDIO_MEDIA_TYPES), byExtension(avAudio))!;
  }
  if (category === "video") {
    return or(typeIn(VIDEO_MEDIA_TYPES), byExtension(avVideo))!;
  }

  // document = pdf + office + ebook + text. The text rule runs last in
  // `classifyFile`, so an audio/video extension has to be excluded from it:
  // `text/plain` named `clip.mp4` is a video, not a document.
  const text = or(
    extensionIn(TEXT_FILE_EXTENSIONS),
    inArray(basenameSql(), [...TEXT_FILE_NAMES]),
    like(files.mediaType, "text/%"),
  )!;
  return or(
    typeIn([PDF_MEDIA_TYPE]),
    typeIn(OFFICE_MEDIA_TYPES),
    typeIn([EPUB_MEDIA_TYPE]),
    byExtension(extensionIn(OFFICE_FILE_EXTENSIONS)),
    byExtension(extensionIn(EBOOK_FILE_EXTENSIONS)),
    byExtension(and(not(or(avAudio, avVideo)!), text)),
  )!;
}

/**
 * Newest-first page of the actor's attachments, plus the filtered row count and
 * the actor's whole storage usage. Ownership is never broader than the actor:
 * there is no admin view over other users' files.
 */
export async function listFilesForActor(
  actor: Actor,
  opts: { offset: number; limit: number; category?: FileListCategory },
): Promise<FileListResponse> {
  // Clamp rather than reject: pagination knobs are cosmetic, and a client
  // asking for 1000 rows still deserves a well-formed page.
  const limit = Math.min(Math.max(opts.limit, 1), FILE_LIST_MAX_LIMIT);
  const offset = Math.max(opts.offset, 0);
  const owner = eq(files.userId, actor.userId);
  const where = opts.category
    ? and(owner, categoryCondition(opts.category))
    : owner;

  const [rows, countRows, totalBytes] = await Promise.all([
    getDb()
      .select({
        id: files.id,
        filename: files.filename,
        mediaType: files.mediaType,
        sizeBytes: files.sizeBytes,
        extractionStatus: files.extractionStatus,
        createdAt: files.createdAt,
        referenced: referencedByMessageSql(),
      })
      .from(files)
      .where(where)
      // created_at is not unique; the id tiebreak keeps offset pages stable.
      .orderBy(desc(files.createdAt), desc(files.id))
      .limit(limit)
      .offset(offset),
    // A separate count, not a window over the page: an offset past the end
    // would otherwise report 0 instead of the real filtered total.
    getDb()
      .select({ total: sql<string>`count(*)::int` })
      .from(files)
      .where(where),
    // Usage answers "how much storage do I use", so the category selection
    // must not move this number — it stays the full usage, matching the card.
    usageBytes(actor.userId),
  ]);

  return {
    files: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      mediaType: row.mediaType,
      sizeBytes: row.sizeBytes,
      extractionStatus: row.extractionStatus,
      createdAt: row.createdAt.toISOString(),
      referenced: row.referenced,
    })),
    totalCount: Number(countRows[0]?.total ?? 0),
    totalBytes,
  };
}

/**
 * True when any persisted message still references the attachment. Not scoped
 * to the owner: a file referenced by anyone must survive until that reference
 * is gone. Built from the same jsonb predicate as {@link referencedByMessageSql}
 * and the sweep, so all three agree by construction.
 */
async function isFileReferenced(fileId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(messageReferencesFileSql(chatMessages.parts, sql`${fileId}`))
    .limit(1);
  return rows.length > 0;
}

export async function deleteFile(id: string, actor: Actor): Promise<void> {
  const file = await getFileForActor(id, actor);
  if (await isFileReferenced(id)) {
    throw new AppError("CONFLICT", 409, "file.inUse");
  }
  // Object first: a storage failure aborts with the row still present and
  // retryable, rather than leaving a row that points at nothing.
  await getFileStorage().delete(file.storageKey);
  await getDb().delete(files).where(eq(files.id, id));
  logger.info({ userId: actor.userId, fileId: id }, "attachment deleted");
  // The local row is gone; the provider copy (if any) is now an orphan. This
  // never throws and never blocks the delete that already succeeded.
  await deleteProviderFileReferences(file);
}

/**
 * Best-effort cascade cleanup after messages are deleted: drops each id that
 * is owned by the actor and no longer referenced by any message. Never throws
 * — the message deletion has already committed, and a leftover row is
 * reclaimed later by `sweepOrphanFiles`.
 */
export async function deleteFilesIfUnreferenced(
  ids: string[],
  actor: Actor,
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return;
  }
  const db = getDb();
  for (const id of unique) {
    try {
      const rows = await db
        .select({
          id: files.id,
          storageKey: files.storageKey,
          providerReferences: files.providerReferences,
        })
        .from(files)
        .where(and(eq(files.id, id), eq(files.userId, actor.userId)))
        .limit(1);
      const row = rows[0];
      if (!row || (await isFileReferenced(id))) {
        continue;
      }
      await getFileStorage().delete(row.storageKey);
      await db.delete(files).where(eq(files.id, id));
      logger.info(
        { userId: actor.userId, fileId: id },
        "attachment cleaned up with its message",
      );
      await deleteProviderFileReferences(row);
    } catch (error) {
      logger.warn(
        { err: error, userId: actor.userId, fileId: id },
        "failed to clean up attachment",
      );
    }
  }
}

/**
 * Reclaims the actor's attachments that were uploaded more than
 * `ORPHAN_FILE_TTL_MS` ago and never referenced by a message. Best-effort by
 * contract: it runs alongside uploads and must never surface a failure.
 */
export async function sweepOrphanFiles(actor: Actor): Promise<void> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - ORPHAN_FILE_TTL_MS);
    const rows = await db
      .select({
        id: files.id,
        storageKey: files.storageKey,
        providerReferences: files.providerReferences,
      })
      .from(files)
      .where(
        and(
          eq(files.userId, actor.userId),
          lt(files.createdAt, cutoff),
          not(referencedByMessageSql()),
        ),
      );

    for (const row of rows) {
      try {
        await getFileStorage().delete(row.storageKey);
        await db.delete(files).where(eq(files.id, row.id));
        logger.info(
          { userId: actor.userId, fileId: row.id },
          "orphan attachment swept",
        );
        await deleteProviderFileReferences(row);
      } catch (error) {
        logger.warn(
          { err: error, userId: actor.userId, fileId: row.id },
          "failed to sweep orphan attachment",
        );
      }
    }
  } catch (error) {
    logger.warn(
      { err: error, userId: actor.userId },
      "orphan attachment sweep failed",
    );
  }
  // Drained after the local sweep so a failed orphan query above cannot starve
  // the provider-side queue. An empty queue is a single indexed read.
  await processDeleteRetries();
}
