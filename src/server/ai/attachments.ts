import "server-only";

import {
  classifyFile,
  type FileCategory,
  fileIdFromUrl,
} from "@/lib/files/media-types";
import type { ChatUIMessage } from "@/lib/schemas/chat";
import { AppError } from "@/server/errors";
import { getFilesByIds, type FileRecord } from "@/server/files/file.service";
import { getFileStorage } from "@/server/files/storage";
import { logger } from "@/server/logger";

/** Capability subset the attachment router consults (`provider_models`). */
export type AttachmentCapabilities = { inputModalities: string[] };

/**
 * How one attachment reaches the model: `native` inlines the file bytes as a
 * data URL and keeps the file part (image when the model advertises vision;
 * pdf when it advertises pdf); otherwise the cached extraction is injected as
 * an `<attachment>` text part (office and plain-text formats always; pdf
 * falls back there).
 */
type AttachmentPlan = { native: boolean; file: FileRecord };

/** Unique file ids referenced by the given messages, in first-seen order. */
function collectFileIds(messages: ChatUIMessage[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "file") {
        continue;
      }
      const id = fileIdFromUrl(part.url);
      if (id === null || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Picks the degraded path for a format that is always extracted. Raises the
 * same user-visible errors the send path depends on:
 * - corrupt/encrypted → `file.unreadable`
 * - scanned/blank document → `file.noTextLayer` (an empty *text* file is a
 *   legitimate attachment and is allowed through — only pdf/office reach this
 *   branch with `empty`)
 * - a missing cache on an otherwise successful extraction is a data bug, not
 *   an empty document, so it is also surfaced as `file.unreadable`.
 */
function planExtracted(
  file: FileRecord,
  category: Exclude<FileCategory, "image">,
): AttachmentPlan {
  if (file.extractionStatus === "failed") {
    throw new AppError("VALIDATION_FAILED", 400, "file.unreadable");
  }
  if (file.extractionStatus === "empty") {
    if (category !== "text") {
      throw new AppError("VALIDATION_FAILED", 400, "file.noTextLayer");
    }
  } else if (file.extractionStatus !== "ok" || file.extractedText === null) {
    // Extraction runs at upload time for every non-image format, so a missing
    // cache here means the row and the extractor disagree.
    logger.warn(
      {
        fileId: file.id,
        mediaType: file.mediaType,
        status: file.extractionStatus,
      },
      "attachment extraction cache missing on send path",
    );
    throw new AppError("VALIDATION_FAILED", 400, "file.unreadable");
  }
  return { native: false, file };
}

/** Routes a single attachment by format against the model's capabilities. */
function planAttachment(
  file: FileRecord,
  supportsImage: boolean,
  supportsPdf: boolean,
): AttachmentPlan {
  const category = classifyFile({
    mediaType: file.mediaType,
    filename: file.filename,
  });
  switch (category) {
    case "image":
      if (!supportsImage) {
        throw new AppError("VALIDATION_FAILED", 400, "file.imageRequiresVision");
      }
      return { native: true, file };
    case "pdf":
      return supportsPdf ? { native: true, file } : planExtracted(file, "pdf");
    case "office":
      return planExtracted(file, "office");
    case "text":
      return planExtracted(file, "text");
    default:
      // Upload only accepts classified formats; an unclassified row means the
      // classification table changed under an old upload.
      throw new AppError("VALIDATION_FAILED", 400, "file.unsupportedType");
  }
}

/** Escapes the one character that could break out of the wrapper attribute. */
function escapeAttribute(value: string): string {
  return value.replaceAll('"', "&quot;");
}

/** Wrapped text part injected for a degraded attachment (design §5). */
function attachmentTextPart(file: FileRecord): ChatUIMessage["parts"][number] {
  const body = file.extractedText ?? "";
  const truncated = file.extractionTruncated ? "true" : "false";
  return {
    type: "text",
    text: `<attachment filename="${escapeAttribute(file.filename)}" truncated="${truncated}">\n${body}\n</attachment>`,
  };
}

function toDataUrl(file: FileRecord, data: Buffer): string {
  return `data:${file.mediaType};base64,${data.toString("base64")}`;
}

/**
 * Rewrites attachment parts into the form the given model can consume.
 *
 * Pure transform: the input messages (and their persisted parts) are never
 * mutated — a fresh array/message/part is returned for every conversion, so
 * the stored parts keep rendering as attachment cards in the UI while only the
 * payload sent to the model changes. Replaying a topic after switching models
 * re-routes every historical attachment against the new model's capabilities.
 *
 * Failures are user-visible `AppError`s (design §9): an image without vision,
 * a scanned document the model cannot read natively, or a corrupt file stops
 * the turn rather than silently sending an empty context.
 */
export async function resolveAttachmentsForModel(
  messages: ChatUIMessage[],
  caps: AttachmentCapabilities,
): Promise<ChatUIMessage[]> {
  const fileIds = collectFileIds(messages);
  if (fileIds.length === 0) {
    return messages;
  }

  // One batched row read for the whole turn, then one storage read per native
  // file — no per-part queries.
  const rows = await getFilesByIds(fileIds);
  const supportsImage = caps.inputModalities.includes("image");
  const supportsPdf = caps.inputModalities.includes("pdf");

  const plans = new Map<string, AttachmentPlan>();
  for (const fileId of fileIds) {
    const file = rows.get(fileId);
    if (!file) {
      // A referenced file is never swept, so this only happens if the row was
      // removed out of band; fail loudly rather than drop the attachment.
      throw new AppError("NOT_FOUND", 404, "file.notFound");
    }
    plans.set(fileId, planAttachment(file, supportsImage, supportsPdf));
  }

  const buffers = new Map<string, Buffer>();
  const nativeFiles = [...plans.values()].filter((plan) => plan.native);
  if (nativeFiles.length > 0) {
    const storage = getFileStorage();
    await Promise.all(
      nativeFiles.map(async ({ file }) => {
        buffers.set(file.storageKey, await storage.get(file.storageKey));
      }),
    );
  }

  let changed = false;
  const routed = messages.map((message) => {
    let partsChanged = false;
    const parts: ChatUIMessage["parts"] = [];
    for (const part of message.parts) {
      if (part.type !== "file") {
        parts.push(part);
        continue;
      }
      const fileId = fileIdFromUrl(part.url);
      const plan = fileId === null ? undefined : plans.get(fileId);
      if (!plan) {
        // Not a canonical attachment url (defensive; schema rejects these).
        parts.push(part);
        continue;
      }
      partsChanged = true;
      if (!plan.native) {
        parts.push(attachmentTextPart(plan.file));
        continue;
      }
      const data = buffers.get(plan.file.storageKey);
      if (!data) {
        throw new AppError("VALIDATION_FAILED", 400, "file.unreadable");
      }
      parts.push({
        type: "file",
        url: toDataUrl(plan.file, data),
        mediaType: plan.file.mediaType,
        filename: plan.file.filename,
      });
    }
    if (!partsChanged) {
      return message;
    }
    changed = true;
    return { ...message, parts };
  });

  return changed ? routed : messages;
}
