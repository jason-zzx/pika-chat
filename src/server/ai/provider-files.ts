import "server-only";

import { APICallError, uploadFile } from "ai";
import { eq, sql } from "drizzle-orm";

import type { ProviderApiFormat } from "@/lib/provider-format";
import type { FilesApiProvider } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/client";
import {
  files,
  providerConfigs,
  type ProviderFileReference,
} from "@/server/db/schema";
import type { FileRecord } from "@/server/files/file.service";
import { getFileStorage } from "@/server/files/storage";
import { logger } from "@/server/logger";

/**
 * Provider-side attachment transport.
 *
 * Uploading once and replaying a `ProviderReference` on later turns keeps
 * attachment bytes out of every request after the first. It is a pure
 * optimization: **our own stored bytes remain the source of truth**, so every
 * failure here degrades to the inline data-URL path and nothing in this module
 * throws.
 */

/** Gemini drops uploaded files after 48h; used when the SDK reports no expiry. */
const GEMINI_REFERENCE_TTL_MS = 48 * 60 * 60 * 1000;

/** Re-upload rather than send a reference that could expire mid-turn. */
const EXPIRY_SAFETY_MARGIN_MS = 30 * 60 * 1000;

/**
 * Statuses meaning "this endpoint will never hand us a reference for this
 * file": no Files API at all, or the file/type is refused. Anything else
 * (429, 5xx, network, timeout) is transient and must not disable the config.
 */
const PERMANENT_UPLOAD_STATUSES = new Set([400, 403, 404, 501]);

export type ProviderReferenceResult =
  | { kind: "reference"; reference: Record<string, string> }
  | { kind: "fallback" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime guard for a stored record. jsonb content is not validated by the
 * driver, and a malformed entry must read as "no reference" rather than crash
 * the send path.
 */
function parseReference(value: unknown): ProviderFileReference | null {
  if (
    !isRecord(value) ||
    !isRecord(value.reference) ||
    typeof value.uploadedAt !== "string" ||
    (value.expiresAt !== undefined &&
      value.expiresAt !== null &&
      typeof value.expiresAt !== "string")
  ) {
    return null;
  }
  const reference: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value.reference)) {
    if (typeof raw !== "string") {
      return null;
    }
    reference[key] = raw;
  }
  if (Object.keys(reference).length === 0) {
    return null;
  }
  return {
    reference,
    uploadedAt: value.uploadedAt,
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
  };
}

/** The reference when it is still comfortably valid, else `null`. */
function usableReference(
  record: ProviderFileReference | null,
): Record<string, string> | null {
  if (record === null) {
    return null;
  }
  if (record.expiresAt === null) {
    return record.reference;
  }
  const expiresAt = Date.parse(record.expiresAt);
  // An unparsable expiry is treated as expired: re-uploading is harmless.
  if (Number.isNaN(expiresAt)) {
    return null;
  }
  return expiresAt - Date.now() > EXPIRY_SAFETY_MARGIN_MS
    ? record.reference
    : null;
}

/** Gemini reports `expirationTime` in its provider metadata (ISO 8601). */
function readExpirationTime(metadata: unknown): string | null {
  if (!isRecord(metadata)) {
    return null;
  }
  const google = metadata.google;
  if (!isRecord(google)) {
    return null;
  }
  const value = google.expirationTime;
  return typeof value === "string" ? value : null;
}

function resolveExpiresAt(
  apiFormat: ProviderApiFormat,
  metadata: unknown,
  uploadedAt: Date,
): string | null {
  // Anthropic files never expire.
  if (apiFormat !== "google") {
    return null;
  }
  const reported = readExpirationTime(metadata);
  if (reported !== null) {
    const parsed = Date.parse(reported);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date(uploadedAt.getTime() + GEMINI_REFERENCE_TTL_MS).toISOString();
}

/**
 * A status-shaped token in an error message: a colon, at least one space, then
 * three digits. Google's templates read `Failed to initiate resumable upload:
 * 404 {…}`, so the space is always there.
 *
 * The space is required on purpose. Without it this also matches the port in a
 * connect error (`attempted address: 10.0.0.1:404`) and any other three-digit
 * number sitting behind a colon — a number that happens to land on
 * 400/403/404/501 would negative-cache a perfectly healthy config forever.
 * Erring the other way costs one extra upload attempt.
 */
const STATUS_IN_MESSAGE = /:\s+(\d{3})\b/;

/**
 * HTTP status behind an upload failure, or `null` when there is none.
 *
 * Anthropic's Files API fails with an `APICallError` carrying `statusCode`;
 * Google's raises a plain `AISDKError` (`GOOGLE_FILES_UPLOAD_ERROR`) with the
 * status embedded in its message — `Failed to initiate resumable upload: 404
 * {…}`. Network failures carry no status at all and stay transient.
 */
function uploadStatus(error: unknown): number | null {
  if (APICallError.isInstance(error)) {
    return typeof error.statusCode === "number" ? error.statusCode : null;
  }
  if (error instanceof Error) {
    const match = STATUS_IN_MESSAGE.exec(error.message);
    if (match?.[1] !== undefined) {
      const status = Number.parseInt(match[1], 10);
      // Only a number that could be an HTTP status counts at all.
      return status >= 100 && status <= 599 ? status : null;
    }
  }
  return null;
}

function isPermanentUploadError(error: unknown): boolean {
  const status = uploadStatus(error);
  return status !== null && PERMANENT_UPLOAD_STATUSES.has(status);
}

async function isMarkedUnsupported(configId: string): Promise<boolean> {
  try {
    const rows = await getDb()
      .select({ at: providerConfigs.filesApiUnsupportedAt })
      .from(providerConfigs)
      .where(eq(providerConfigs.id, configId))
      .limit(1);
    return rows[0]?.at != null;
  } catch (error) {
    // A failed read retries the upload — the safe direction to be wrong in.
    logger.warn(
      { err: error, providerConfigId: configId },
      "files api negative-cache read failed",
    );
    return false;
  }
}

async function markUnsupported(configId: string): Promise<void> {
  try {
    await getDb()
      .update(providerConfigs)
      .set({ filesApiUnsupportedAt: new Date() })
      .where(eq(providerConfigs.id, configId));
    logger.info(
      { providerConfigId: configId },
      "provider config marked without files api support",
    );
  } catch (error) {
    logger.warn(
      { err: error, providerConfigId: configId },
      "files api negative-cache write failed",
    );
  }
}

/** Merges one config's record: other configs' keys are untouched. */
async function persistReference(
  fileId: string,
  configId: string,
  record: ProviderFileReference,
): Promise<void> {
  try {
    await getDb()
      .update(files)
      .set({
        providerReferences: sql`${files.providerReferences} || ${JSON.stringify({ [configId]: record })}::jsonb`,
      })
      .where(eq(files.id, fileId));
  } catch (error) {
    // The reference is still valid for this turn; only the cache is lost.
    logger.warn(
      { err: error, fileId, providerConfigId: configId },
      "provider file reference write failed",
    );
  }
}

/**
 * Resolves a provider reference for `file` against `configId`, uploading on
 * the send path when there is no usable one yet.
 *
 * Returns `{ kind: "fallback" }` — never throws — when the format has no Files
 * API, the config is negative-cached, or the upload fails. The caller then
 * inlines the bytes exactly as before this optimization existed.
 */
export async function ensureProviderReference(args: {
  file: FileRecord;
  configId: string;
  apiFormat: ProviderApiFormat;
  filesApi: FilesApiProvider | null;
}): Promise<ProviderReferenceResult> {
  const { file, configId, apiFormat, filesApi } = args;
  if (filesApi === null) {
    return { kind: "fallback" };
  }
  try {
    if (await isMarkedUnsupported(configId)) {
      return { kind: "fallback" };
    }
    const stored = usableReference(
      parseReference(file.providerReferences[configId]),
    );
    if (stored !== null) {
      return { kind: "reference", reference: stored };
    }

    const data = await getFileStorage().get(file.storageKey);
    const result = await uploadFile({
      api: filesApi,
      data,
      mediaType: file.mediaType,
      filename: file.filename,
    });
    const uploadedAt = new Date();
    const record: ProviderFileReference = {
      reference: { ...result.providerReference },
      uploadedAt: uploadedAt.toISOString(),
      expiresAt: resolveExpiresAt(apiFormat, result.providerMetadata, uploadedAt),
    };
    await persistReference(file.id, configId, record);
    return { kind: "reference", reference: record.reference };
  } catch (error) {
    const statusCode = uploadStatus(error);
    if (isPermanentUploadError(error)) {
      await markUnsupported(configId);
    }
    logger.warn(
      {
        fileId: file.id,
        providerConfigId: configId,
        statusCode,
        errorName: error instanceof Error ? error.name : undefined,
      },
      "provider file upload failed; sending attachment inline",
    );
    return { kind: "fallback" };
  }
}
