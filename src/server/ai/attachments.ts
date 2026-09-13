import "server-only";

import {
  AUDIO_MEDIA_TYPES,
  classifyFile,
  type FileCategory,
  fileIdFromUrl,
  normalizeMediaType,
  VIDEO_MEDIA_TYPES,
} from "@/lib/files/media-types";
import type { ProviderApiFormat } from "@/lib/provider-format";
import type { ChatUIMessage } from "@/lib/schemas/chat";
import { AppError } from "@/server/errors";
import {
  fileUrl,
  getFilesByIds,
  type FileRecord,
} from "@/server/files/file.service";
import { getFileStorage } from "@/server/files/storage";
import { logger } from "@/server/logger";
import type { FilesApiProvider } from "@/server/ai/provider-factory";
import { ensureProviderReference } from "@/server/ai/provider-files";

/**
 * Capability subset the attachment router consults: the model's declared
 * modalities (`provider_models`), plus what the selected provider config can
 * transport.
 */
export type AttachmentCapabilities = {
  inputModalities: string[];
  apiFormat: ProviderApiFormat;
  providerConfigId: string;
  filesApi: FilesApiProvider | null;
};

/**
 * Which audio/video media types each endpoint api format can actually put on
 * the wire. This is a *serialization* capability, separate from the model's
 * declared input modality: a model may advertise `audio` while the format in
 * front of it cannot carry it, and that combination has to fail here with a
 * clear error instead of surfacing the SDK's `UnsupportedFunctionality`.
 *
 * - `google`: every whitelisted audio and video type (Gemini accepts the
 *   containers the browser produces).
 * - `openai-compatible`: `input_audio` only, and only for wav/mp3 — no video
 *   part exists in the chat completion payload at all.
 * - `claude`: none. Anthropic's messages API takes no audio/video part, so an
 *   audio-capable model behind a claude endpoint is still unsupported.
 */
const AV_SERIALIZATION: Record<
  ProviderApiFormat,
  { audio: ReadonlySet<string>; video: ReadonlySet<string> }
> = {
  google: {
    audio: new Set(AUDIO_MEDIA_TYPES),
    video: new Set(VIDEO_MEDIA_TYPES),
  },
  claude: { audio: new Set(), video: new Set() },
  "openai-compatible": {
    // The SDK's `input_audio` only expresses wav and mp3. `audio/x-wav` is
    // absent on purpose: MEDIA_TYPE_ALIASES folds it onto `audio/wav` before
    // this gate ever runs, and if that alias ever regresses this set must
    // fail closed rather than hand the SDK a type it rejects with a raw
    // `UnsupportedFunctionalityError`.
    audio: new Set(["audio/wav", "audio/mpeg", "audio/mp3"]),
    video: new Set(),
  },
};

/**
 * How one attachment reaches the model: `native` sends the file part with the
 * bytes (image when the model advertises vision; pdf when it advertises pdf;
 * audio/video when both gates pass) — either as a provider Files API reference
 * when one is available, or as an inline data URL; otherwise the cached
 * extraction is injected as an `<attachment>` text part (office and
 * plain-text formats always; pdf falls back there).
 */
type AttachmentPlan = { native: boolean; file: FileRecord };

/** The model's declared modalities, resolved once per turn. */
type ModalitySupport = {
  image: boolean;
  pdf: boolean;
  audio: boolean;
  video: boolean;
};

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
 *   legitimate attachment and is allowed through — pdf/office/ebook reach
 *   this branch with `empty`)
 * - a missing cache on an otherwise successful extraction is a data bug, not
 *   an empty document, so it is also surfaced as `file.unreadable`.
 */
function planExtracted(
  file: FileRecord,
  category: Exclude<FileCategory, "image" | "audio" | "video">,
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

/**
 * Second gate for audio/video: the model wants the modality *and* the endpoint
 * format can serialize this exact media type. Failing either is terminal —
 * there is no extraction fallback for media, and letting it through would only
 * postpone the failure into an SDK-level `UnsupportedFunctionality` error the
 * user cannot act on.
 */
function mediaUnsupported(
  category: "audio" | "video",
  mediaType: string,
  apiFormat: ProviderApiFormat,
): boolean {
  const serializable = AV_SERIALIZATION[apiFormat];
  const allowed =
    category === "audio" ? serializable.audio : serializable.video;
  return !allowed.has(normalizeMediaType(mediaType));
}

/** Routes a single attachment by format against the model's capabilities. */
function planAttachment(
  file: FileRecord,
  support: ModalitySupport,
  apiFormat: ProviderApiFormat,
): AttachmentPlan {
  const category = classifyFile({
    mediaType: file.mediaType,
    filename: file.filename,
  });
  switch (category) {
    case "image":
      if (!support.image) {
        throw new AppError("VALIDATION_FAILED", 400, "file.imageRequiresVision");
      }
      return { native: true, file };
    case "pdf":
      return support.pdf ? { native: true, file } : planExtracted(file, "pdf");
    case "audio":
    case "video": {
      const declared = category === "audio" ? support.audio : support.video;
      if (!declared || mediaUnsupported(category, file.mediaType, apiFormat)) {
        throw new AppError("VALIDATION_FAILED", 400, "file.mediaUnsupported");
      }
      return { native: true, file };
    }
    case "office":
      return planExtracted(file, "office");
    case "ebook":
      return planExtracted(file, "ebook");
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
  return `data:${normalizeMediaType(file.mediaType)};base64,${data.toString("base64")}`;
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
 * a scanned document the model cannot read natively, media the model or the
 * endpoint format cannot carry, or a corrupt file stops the turn rather than
 * silently sending an empty context.
 */
export async function resolveAttachmentsForModel(
  messages: ChatUIMessage[],
  caps: AttachmentCapabilities,
): Promise<ChatUIMessage[]> {
  const fileIds = collectFileIds(messages);
  if (fileIds.length === 0) {
    return messages;
  }

  // One batched row read for the whole turn, then a reference lookup per
  // native file and a storage read only for the ones that still need bytes.
  const rows = await getFilesByIds(fileIds);
  const support: ModalitySupport = {
    image: caps.inputModalities.includes("image"),
    pdf: caps.inputModalities.includes("pdf"),
    audio: caps.inputModalities.includes("audio"),
    video: caps.inputModalities.includes("video"),
  };

  const plans = new Map<string, AttachmentPlan>();
  for (const fileId of fileIds) {
    const file = rows.get(fileId);
    if (!file) {
      // A referenced file is never swept, so this only happens if the row was
      // removed out of band; fail loudly rather than drop the attachment.
      throw new AppError("NOT_FOUND", 404, "file.notFound");
    }
    plans.set(fileId, planAttachment(file, support, caps.apiFormat));
  }

  const buffers = new Map<string, Buffer>();
  const nativeFiles = [...plans.values()].filter((plan) => plan.native);
  // Second stage of the native branch: a provider Files API reference replaces
  // the bytes when one can be resolved. Only files without a reference are read
  // from storage at all.
  const references = new Map<string, Record<string, string>>();
  if (nativeFiles.length > 0 && caps.filesApi !== null) {
    await Promise.all(
      nativeFiles.map(async ({ file }) => {
        const resolved = await ensureProviderReference({
          file,
          configId: caps.providerConfigId,
          apiFormat: caps.apiFormat,
          filesApi: caps.filesApi,
        });
        if (resolved.kind === "reference") {
          references.set(file.id, resolved.reference);
        }
      }),
    );
  }
  const inlineFiles = nativeFiles.filter(
    ({ file }) => !references.has(file.id),
  );
  if (inlineFiles.length > 0) {
    const storage = getFileStorage();
    await Promise.all(
      inlineFiles.map(async ({ file }) => {
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
      const reference = references.get(plan.file.id);
      if (reference) {
        // url stays canonical so attachment cards keep rendering; the SDK
        // prefers the reference over it when building the model message.
        parts.push({
          type: "file",
          url: fileUrl(plan.file.id),
          mediaType: normalizeMediaType(plan.file.mediaType),
          filename: plan.file.filename,
          providerReference: reference,
        });
        continue;
      }
      const data = buffers.get(plan.file.storageKey);
      if (!data) {
        throw new AppError("VALIDATION_FAILED", 400, "file.unreadable");
      }
      parts.push({
        type: "file",
        url: toDataUrl(plan.file, data),
        mediaType: normalizeMediaType(plan.file.mediaType),
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
