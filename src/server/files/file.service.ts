import "server-only";

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_FILE_BYTES,
  MAX_FILE_SIZE_LABEL,
} from "@/lib/files/constants";
import {
  classifyFile,
  type FileCategory,
  fileExtension,
  FILE_URL_PREFIX,
  normalizeMediaType,
} from "@/lib/files/media-types";
import { newId } from "@/lib/id";
import type { ChatFilePart } from "@/lib/schemas/chat";
import type { FileExtractionState } from "@/lib/schemas/file";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { chatMessages, files } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

import { extractDocument } from "./extract";
import { getFileStorage } from "./storage";

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

/** Attachments unreferenced for this long are reclaimable by the sweeper. */
export const ORPHAN_FILE_TTL_MS = 24 * 60 * 60 * 1000;

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

/**
 * Media type to persist. Browsers send `""` for many code/text files, which
 * still classify by extension — this gives those a truthful stored type so the
 * download response and the native-transmission path are not octet-stream.
 */
function storedMediaType(declared: string, filename: string): string {
  const normalized = normalizeMediaType(declared);
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
  if (category === "image") {
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
  if (sizeBytes > MAX_FILE_BYTES) {
    throw new AppError("VALIDATION_FAILED", 400, "file.tooLarge", {
      limit: MAX_FILE_SIZE_LABEL,
    });
  }

  const mediaType = storedMediaType(input.mediaType, filename);
  const id = newId();
  const storageKey = `${actor.userId}/${id}`;
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

/** Owned-row lookup plus the stored bytes, for download and native routing. */
export async function readFileForActor(
  id: string,
  actor: Actor,
): Promise<{ file: FileRecord; data: Buffer }> {
  const file = await getFileForActor(id, actor);
  const data = await getFileStorage().get(file.storageKey);
  return { file, data };
}

/**
 * True when any persisted message still references the attachment. Not scoped
 * to the owner: a file referenced by anyone must survive until that reference
 * is gone.
 */
async function isFileReferenced(fileId: string): Promise<boolean> {
  const payload = JSON.stringify([{ url: fileUrl(fileId) }]);
  const rows = await getDb()
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(sql`${chatMessages.parts} @> ${payload}::jsonb`)
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
        .select({ id: files.id, storageKey: files.storageKey })
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
      .select({ id: files.id, storageKey: files.storageKey })
      .from(files)
      .where(
        and(
          eq(files.userId, actor.userId),
          lt(files.createdAt, cutoff),
          sql`not exists (
            select 1 from chat_messages cm
            where cm.parts @> jsonb_build_array(
              jsonb_build_object('url', '/api/files/' || ${files.id})
            )
          )`,
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
}
