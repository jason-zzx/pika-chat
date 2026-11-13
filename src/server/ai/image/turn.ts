import "server-only";

import { createUIMessageStream } from "ai";


import { fileIdFromUrl } from "@/lib/files/media-types";
import {
  imageCapabilityFor,
  isSizeAllowed,
  type ImageModelCapability,
} from "@/lib/image-capabilities";
import { newId } from "@/lib/id";
import type {
  ChatFilePart,
  ChatMessageOutcome,
  ChatUIMessage,
  ImageGenerationParams,
} from "@/lib/schemas/chat";
import type { ChatModelHandle } from "@/server/ai/chat-model";
import {
  generateImageForEndpoint,
  type GeneratedImage,
} from "@/server/ai/image/generate";
import { createStreamFailureTracker } from "@/server/ai/stream-failure";
import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import {
  deleteFile,
  getFilesByIds,
  resolveOwnedFileParts,
  uploadFile,
} from "@/server/files/file.service";
import { getFileStorage } from "@/server/files/storage";
import { logger } from "@/server/logger";
import type {
  TurnFinalizeInput,
  TurnHooks,
} from "@/server/ai/generation-turn";

/** First offending image parameter, or null when the request is usable. */
function invalidImageParam(
  capability: ImageModelCapability,
  image: ImageGenerationParams | undefined,
): "size" | "n" | "quality" | "imageSize" | null {
  if (!image) {
    return null;
  }
  if (image.size !== undefined && !isSizeAllowed(capability, image.size)) {
    return "size";
  }
  if (image.n !== undefined && image.n > capability.nMax) {
    return "n";
  }
  if (
    image.quality !== undefined &&
    !capability.qualities?.includes(image.quality)
  ) {
    return "quality";
  }
  // A capability without imageSizes rejects any imageSize tier outright.
  if (
    image.imageSize !== undefined &&
    !capability.imageSizes?.includes(image.imageSize)
  ) {
    return "imageSize";
  }
  return null;
}

/**
 * Pre-flight gate shared by both image routes: claude has no image adapter,
 * and request params must fit the model's capability table. Throws before any
 * persistence so a rejected turn leaves nothing behind.
 */
export function assertImageGenerationSupported(
  apiFormat: ChatModelHandle["apiFormat"],
  modelId: string,
  image: ImageGenerationParams | undefined,
): void {
  if (apiFormat === "claude") {
    throw new AppError("VALIDATION_FAILED", 400, "model.imageUnsupported");
  }
  const invalid = invalidImageParam(imageCapabilityFor(modelId), image);
  if (invalid) {
    throw new AppError("VALIDATION_FAILED", 400, "image.invalidParams", {
      param: invalid,
    });
  }
}

/**
 * Reference-image resolution shared by both image routes (design §3.1/§3.4):
 * ownership + canonicalization via the text path's resolveOwnedFileParts,
 * then the graded capability checks, then the byte read. Everything throws
 * before any topic/message row exists, so a rejected turn leaves nothing
 * behind. Returns the canonical parts (for persisting on the user message)
 * alongside the decoded references.
 */
export async function resolveImageReferences(
  parts: ChatFilePart[],
  actor: Actor,
  modelId: string,
): Promise<{ parts: ChatFilePart[]; references: GeneratedImage[] }> {
  const owned = await resolveOwnedFileParts(parts, actor);
  if (owned.length === 0) {
    return { parts: [], references: [] };
  }
  const imageInput = imageCapabilityFor(modelId).imageInput;
  if (!imageInput) {
    throw new AppError("VALIDATION_FAILED", 400, "image.attachmentUnsupported");
  }
  if (owned.length > imageInput.max) {
    throw new AppError("VALIDATION_FAILED", 400, "image.tooManyReferences", {
      max: imageInput.max,
    });
  }
  if (owned.some((part) => !part.mediaType.startsWith("image/"))) {
    throw new AppError("VALIDATION_FAILED", 400, "image.referenceNotImage");
  }
  // resolveOwnedFileParts already authorized every id, so the batch read
  // (which does not filter by owner) is safe here.
  const rows = await getFilesByIds(
    owned.map((part) => fileIdFromUrl(part.url) ?? ""),
  );
  const storage = getFileStorage();
  const references = await Promise.all(
    owned.map(async (part) => {
      const row = rows.get(fileIdFromUrl(part.url) ?? "");
      if (!row) {
        throw new AppError("NOT_FOUND", 404, "file.notFound");
      }
      return {
        bytes: await storage.get(row.storageKey),
        mediaType: row.mediaType,
      };
    }),
  );
  return { parts: owned, references };
}

const GENERATED_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/png": "png",
  "image/gif": "gif",
};

/**
 * Single non-streaming generation turn for an image-output model (design §3):
 * one provider call, each image stored as a regular attachment, and one
 * complete assistant message delivered over the UI message stream protocol so
 * the client's consumption path is unchanged.
 *
 * Runs as a background turn like the text path (chat task R1): the produced
 * chunks go to the runner, which fans them out to whatever subscribers exist
 * and persists the result through `hooks.finalize`. A failed or stopped batch
 * still commits nothing and reclaims the images it uploaded.
 */
export async function runImageTurn(
  {
    actor,
    handle,
    providerConfigId,
    modelId,
    image,
    prompt,
    references,
    topicId,
    messageId,
    signal,
  }: {
    actor: Actor;
    handle: ChatModelHandle;
    providerConfigId: string;
    modelId: string;
    image: ImageGenerationParams | undefined;
    prompt: string;
    /** Reference images resolved from the user message's file parts. */
    references?: GeneratedImage[];
    topicId: string;
    /** Pre-allocated assistant row this turn fills. */
    messageId: string;
    signal: AbortSignal;
  },
  hooks: TurnHooks,
): Promise<void> {
  const abortSignal = signal;
  const t = hooks.t;
  const failure = createStreamFailureTracker(handle.describeError, t);
  // Captured before generation so the persisted createdAt matches the
  // finish metadata, like streamStartedAt on the streaming path.
  const generatedAt = new Date();

  logger.info(
    { userId: actor.userId, topicId, model: modelId, providerConfigId },
    "image generation started",
  );

  // Parts accumulated in execute; finalization persists them on success only, so
  // a failed or stopped turn never leaves half-written images behind.
  const generatedParts: ChatUIMessage["parts"] = [];

  const stream = createUIMessageStream<ChatUIMessage>({
    generateId: newId,
    execute: async ({ writer }) => {
      // The start chunk carries the assistant row id, so a reconnecting
      // client replays into that same message (B6 + chat task §6).
      writer.write({ type: "start", messageId });
      const result = await generateImageForEndpoint(
        handle.endpoint,
        modelId,
        {
          prompt,
          n: image?.n ?? 1,
          // Empty stays undefined: a no-references request must remain
          // byte-identical to plain text-to-image.
          references: references?.length ? references : undefined,
          ...(image?.size ? { size: image.size } : {}),
          ...(image?.quality ? { quality: image.quality } : {}),
          // imageSize is a Gemini-only tier: the openai-compatible adapter
          // has no such parameter, so a gateway serving a gemini model over
          // the OpenAI format would silently drop it. Strip it instead of
          // letting "user picked 2K, got 1K" pass validation unnoticed.
          ...(image?.imageSize && handle.endpoint.apiFormat === "google"
            ? { imageSize: image.imageSize }
            : {}),
        },
        abortSignal,
      );
      // Stored ids are tracked so a mid-batch failure (quota, abort) can
      // clean up the images already written instead of leaving them
      // unreferenced and counting against the quota until the orphan sweep.
      const storedFileIds: string[] = [];
      const cleanupStoredFiles = async () => {
        for (const fileId of storedFileIds) {
          try {
            await deleteFile(fileId, actor);
          } catch (cleanupError) {
            // Best-effort: the orphan sweep reclaims whatever is left.
            logger.warn(
              { err: cleanupError, fileId, userId: actor.userId },
              "generated image cleanup failed",
            );
          }
        }
      };
      // Filename carries the model and generation time so stored files are
      // distinguishable; same-second batches disambiguate with a 1-based index.
      const nameBase = `${modelId.replace(/[^a-z0-9]+/gi, "-")}-${generatedAt
        .toISOString()
        .slice(0, 19)
        .replace(/[T:]/g, "-")}`;
      try {
        for (const [index, generated] of result.images.entries()) {
          // A stop can land between generation and the upload loop: skip the
          // rest and reclaim what is already stored (same as a mid-batch
          // failure) — nothing will reference these rows.
          if (abortSignal.aborted) break;
          // The upload service owns validation, quota, storage and the row —
          // a generated image is just an attachment written from bytes. The
          // per-file upload cap is skipped (a 4K render outgrows it); the
          // storage quota is not.
          const uploaded = await uploadFile(
            {
              filename: `${nameBase}${result.images.length > 1 ? `-${index + 1}` : ""}.${GENERATED_IMAGE_EXTENSIONS[generated.mediaType] ?? "png"}`,
              mediaType: generated.mediaType,
              data: generated.bytes,
            },
            actor,
            { skipSizeLimit: true },
          );
          storedFileIds.push(uploaded.id);
          const filePart: ChatFilePart = {
            type: "file",
            url: uploaded.url,
            mediaType: uploaded.mediaType,
            filename: uploaded.filename,
            sizeBytes: uploaded.sizeBytes,
          };
          generatedParts.push(filePart);
          writer.write({
            type: "file",
            url: uploaded.url,
            mediaType: uploaded.mediaType,
          });
        }
      } catch (error) {
        await cleanupStoredFiles();
        throw error;
      }
      if (abortSignal.aborted) {
        await cleanupStoredFiles();
      }
      if (result.text) {
        generatedParts.push({ type: "text", text: result.text });
        writer.write({ type: "text-start", id: "text-1" });
        writer.write({ type: "text-delta", id: "text-1", delta: result.text });
        writer.write({ type: "text-end", id: "text-1" });
      }
      writer.write({
        type: "finish",
        messageMetadata: {
          providerConfigId,
          modelId,
          createdAt: generatedAt.toISOString(),
        },
      });
    },
    onError: (error: unknown) => failure.describe(error),
  });

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      hooks.onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
  const outcome: ChatMessageOutcome = abortSignal.aborted
    ? "stopped"
    : failure.sawFailure ? "failed" : "completed";
  const final: TurnFinalizeInput = {
    parts: outcome === "completed" ? generatedParts : [],
    outcome,
    errorMessage: outcome === "failed" ? failure.message : null,
    generatedFileUrls: generatedParts.flatMap((part) =>
      part.type === "file" ? [part.url] : [],
    ),
  };
  await hooks.finalize(final);
}
