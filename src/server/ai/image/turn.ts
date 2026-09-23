import "server-only";

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import type { ErrorsTranslator } from "@/lib/api/error-contract";
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
import { generateImageForEndpoint } from "@/server/ai/image/generate";
import { createStreamFailureTracker } from "@/server/ai/stream-failure";
import { registerStream, releaseStream } from "@/server/ai/stream-registry";
import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { deleteFile, uploadFile } from "@/server/files/file.service";
import { logger } from "@/server/logger";
import { appendAssistantMessage } from "@/server/services/message.service";
import { touchTopicUpdatedAt } from "@/server/services/topic.service";

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
 * The two callers differ only in framing: /api/chat announces the (possibly
 * freshly created) topic via a `data-topic` chunk, while the regenerate route
 * carries the stream id in the `x-pika-stream-id` response header and joins
 * the target version group via `groupId`.
 */
export async function createImageGenerationResponse({
  actor,
  handle,
  t,
  providerConfigId,
  modelId,
  image,
  prompt,
  topicId,
  groupId,
  announceTopic,
}: {
  actor: Actor;
  handle: ChatModelHandle;
  t: ErrorsTranslator;
  providerConfigId: string;
  modelId: string;
  image: ImageGenerationParams | undefined;
  prompt: string;
  topicId: string;
  /** Existing version group to add the answer to; omit for a new group. */
  groupId?: string;
  /** /api/chat emits a data-topic chunk; regenerate uses the header instead. */
  announceTopic: boolean;
}): Promise<Response> {
  const streamId = newId();
  const abortSignal = registerStream(streamId, actor.userId);
  const failure = createStreamFailureTracker(handle.describeError, t);
  // Captured before generation so the persisted createdAt matches the
  // finish metadata, like streamStartedAt on the streaming path.
  const generatedAt = new Date();
  const messageId = newId();

  logger.info(
    { userId: actor.userId, topicId, model: modelId, providerConfigId },
    "image generation started",
  );

  // Parts accumulated in execute; onEnd persists them on success only, so
  // a failed or stopped turn never leaves half-written images behind.
  const generatedParts: ChatUIMessage["parts"] = [];

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: async ({ writer }) => {
      if (announceTopic) {
        writer.write({ type: "data-topic", data: { topicId, streamId } });
      }
      // The start chunk carries the id onEnd persists (B6).
      writer.write({ type: "start", messageId });
      const result = await generateImageForEndpoint(
        handle.endpoint,
        modelId,
        {
          prompt,
          n: image?.n ?? 1,
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
      try {
        for (const generated of result.images) {
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
              filename: `generated.${GENERATED_IMAGE_EXTENSIONS[generated.mediaType] ?? "png"}`,
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
    onEnd: async ({ isAborted }) => {
      try {
        const stopped = isAborted || abortSignal.aborted;
        const failed = !stopped && failure.sawFailure;
        const outcome: ChatMessageOutcome = stopped
          ? "stopped"
          : failed
            ? "failed"
            : "completed";
        await appendAssistantMessage(
          {
            topicId,
            message: {
              id: messageId,
              role: "assistant",
              parts: outcome === "completed" ? generatedParts : [],
            },
            outcome,
            errorMessage: failed ? failure.message : null,
            providerConfigId,
            modelId,
            createdAt: generatedAt,
            ...(groupId ? { groupId } : {}),
          },
          actor,
        );
        await touchTopicUpdatedAt(topicId, actor);
      } finally {
        releaseStream(streamId);
      }
    },
  });

  return createUIMessageStreamResponse({
    stream,
    ...(announceTopic ? {} : { headers: { "x-pika-stream-id": streamId } }),
  });
}
