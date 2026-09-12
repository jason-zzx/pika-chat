import { parseEmpty, parseJson } from "@/lib/api/parse";
import { FILE_URL_PREFIX } from "@/lib/files/media-types";
import { uploadedFileSchema, type UploadedFile } from "@/lib/schemas/file";

/** Uploads one attachment (multipart field `file`) and returns its row. */
export async function uploadChatFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/files", { method: "POST", body: form });
  return parseJson(response, (data) => uploadedFileSchema.parse(data));
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
