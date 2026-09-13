import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  DEFAULT_MAX_FILE_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/files/constants";
import { FILE_URL_PREFIX } from "@/lib/files/media-types";
import {
  fileLimitsSchema,
  presignedUploadSchema,
  uploadedFileSchema,
  type FileLimits,
  type PresignedUpload,
  type UploadedFile,
} from "@/lib/schemas/file";

/**
 * Limits used when the server endpoint is unreachable or answers with an
 * unexpected shape. Mirrors the server defaults so the composer degrades to a
 * working (if conservative) size check instead of disabling attachments.
 */
export const DEFAULT_FILE_LIMITS: FileLimits = {
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
  maxAttachmentsPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
  directUpload: false,
  usedBytes: 0,
  quotaBytes: null,
};

/** Fetches the current upload limits, falling back to the defaults on any failure. */
export async function fetchFileLimits(): Promise<FileLimits> {
  try {
    const response = await fetch("/api/files/limits");
    if (!response.ok) {
      return DEFAULT_FILE_LIMITS;
    }
    const parsed = fileLimitsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : DEFAULT_FILE_LIMITS;
  } catch {
    return DEFAULT_FILE_LIMITS;
  }
}

/** Uploads one attachment (multipart field `file`) and returns its row. */
export async function uploadChatFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/files", { method: "POST", body: form });
  return parseJson(response, (data) => uploadedFileSchema.parse(data));
}

/** Requests a presigned POST policy for a direct browser→storage upload. */
export async function presignChatFile(file: File): Promise<PresignedUpload> {
  const response = await fetch("/api/files/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mediaType: file.type }),
  });
  return parseJson(response, (data) => presignedUploadSchema.parse(data));
}

/**
 * Posts the bytes straight to object storage using the signed policy. The
 * `file` field must come last — an S3 POST policy ignores anything after it.
 */
export async function uploadToPresignedPost(
  post: PresignedUpload["post"],
  file: File,
): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(post.fields)) {
    form.append(name, value);
  }
  form.append("file", file);
  const response = await fetch(post.url, { method: "POST", body: form });
  if (!response.ok) {
    // Storage answers plain XML/HTML, not our error envelope; the chip falls
    // back to `file.uploadFailed`.
    throw new Error(`Direct upload failed with status ${response.status}`);
  }
}

/** Finalizes a direct upload and returns the stored row. */
export async function completeChatFile(fileId: string): Promise<UploadedFile> {
  const response = await fetch("/api/files/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  return parseJson(response, (data) => uploadedFileSchema.parse(data));
}

/** Direct (presigned) upload, start to finish: presign → storage → complete. */
export async function uploadChatFileDirect(file: File): Promise<UploadedFile> {
  const presigned = await presignChatFile(file);
  await uploadToPresignedPost(presigned.post, file);
  return completeChatFile(presigned.fileId);
}

/**
 * Removes a staged attachment. Referenced files answer 409 — the caller keeps
 * the chip and lets the message-deletion cascade reclaim it later.
 */
export async function deleteChatFile(fileId: string): Promise<void> {
  const response = await fetch(
    `${FILE_URL_PREFIX}${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
  await parseEmpty(response);
}
