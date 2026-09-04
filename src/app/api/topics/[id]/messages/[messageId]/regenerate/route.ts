import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type ToolSet,
} from "ai";

import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { newId } from "@/lib/id";
import {
  regenerateMessageRequestSchema,
  type ChatMessageOutcome,
  type ChatUIMessage,
} from "@/lib/schemas/chat";
import { createChatModelHandle } from "@/server/ai/chat-model";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import { resolvedMaxOutputTokens } from "@/server/ai/output-budget";
import { resolvedReasoningEffort } from "@/server/ai/reasoning-effort";
import { createReasoningTimer } from "@/server/ai/reasoning-timer";
import { registerStream, releaseStream } from "@/server/ai/stream-registry";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  appendAssistantMessage,
  resolveRegenerateTarget,
} from "@/server/services/message.service";
import {
  findTopicContextForActor,
  touchTopicUpdatedAt,
} from "@/server/services/topic.service";

function partsHaveText(message: ChatUIMessage): boolean {
  return message.parts.some(
    (part) => part.type === "text" && part.text.length > 0,
  );
}

/**
 * Streams a new version for the answer at `messageId`. Same skeleton as
 * /api/chat (model availability → handle → registerStream → streamText →
 * createUIMessageStream → onEnd persists), minus topic creation, user-message
 * append, and title generation. The stream contains only the new assistant
 * message; the stream id travels in the x-pika-stream-id response header so
 * the client (which consumes the stream manually, not via useChat) can stop it.
 */
export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "Topic not found");
  const messageId = await requireParam(context, "messageId", "Message not found");
  const input = regenerateMessageRequestSchema.parse(await request.json());

  const available = await resolveAvailableModels(actor);
  const selected = available.find(
    (model) =>
      model.configId === input.providerConfigId &&
      model.modelId === input.modelId,
  );
  if (!selected) {
    throw new AppError(
      "VALIDATION_FAILED",
      400,
      "Selected model is not available",
    );
  }
  const reasoningEffort = resolvedReasoningEffort(
    selected,
    input.reasoningEffort,
  );

  const handle = await createChatModelHandle(
    {
      providerConfigId: input.providerConfigId,
      modelId: input.modelId,
    },
    actor,
  );

  const topicContext = await findTopicContextForActor(topicId, actor);
  if (!topicContext) {
    throw new AppError("NOT_FOUND", 404, "Topic not found");
  }

  const { targetGroupId, history } = await resolveRegenerateTarget(
    { topicId, messageId },
    actor,
  );
  const modelMessages = await convertToModelMessages(history);

  const streamId = newId();
  const abortSignal = registerStream(streamId, actor.userId);

  logger.info(
    {
      userId: actor.userId,
      topicId,
      messageId,
      targetGroupId,
      model: input.modelId,
      providerConfigId: input.providerConfigId,
    },
    "chat regeneration started",
  );

  let accumulatedText = "";
  let streamErrorMessage: string | null = null;
  // Captured before the model call so the persisted assistant createdAt
  // matches what a history reload will return.
  const streamStartedAt = new Date();
  const reasoningTimer = createReasoningTimer();
  let reasoningMsEmitted = false;
  // Assigned from the UI stream's execute closure, where the writer exists.
  let emitReasoningMetadata: (() => void) | null = null;

  const result = streamText({
    model: handle.model,
    messages: modelMessages,
    instructions: topicContext.assistant.systemPrompt ?? undefined,
    abortSignal,
    maxOutputTokens: resolvedMaxOutputTokens(selected),
    providerOptions:
      reasoningEffort === undefined
        ? undefined
        : {
            openaiCompatible: { reasoningEffort },
          },
    onError: ({ error }) => {
      logger.error(
        {
          topicId,
          errorName: error instanceof Error ? error.name : undefined,
        },
        "streamText failed",
      );
    },
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") {
        accumulatedText += chunk.text;
      }
      reasoningTimer.onChunk(chunk);
      emitReasoningMetadata?.();
    },
  });

  void result.consumeStream();

  const stream = createUIMessageStream<ChatUIMessage>({
    generateId: newId,
    execute: ({ writer }) => {
      emitReasoningMetadata = () => {
        if (reasoningMsEmitted) {
          return;
        }
        const reasoningMs = reasoningTimer.measure();
        if (reasoningMs === undefined) {
          return;
        }
        reasoningMsEmitted = true;
        writer.write({
          type: "message-metadata",
          messageMetadata: { reasoningMs },
        });
      };
      writer.merge(
        toUIMessageStream<ToolSet, ChatUIMessage>({
          stream: result.stream,
          generateMessageId: newId,
          // sendStart must stay enabled so the streamed message id matches
          // the row onEnd persists (see /api/chat; B6).
          sendStart: true,
          sendReasoning: true,
          messageMetadata: ({ part }) => {
            if (part.type !== "finish") {
              return undefined;
            }
            return {
              providerConfigId: input.providerConfigId,
              modelId: input.modelId,
              totalTokens: part.totalUsage.totalTokens,
              finishReason: part.finishReason,
              createdAt: streamStartedAt.toISOString(),
              reasoningMs: reasoningTimer.measure(),
            };
          },
        }),
      );
    },
    onError: (error: unknown) => {
      streamErrorMessage = handle.describeError(error).message;
      return streamErrorMessage;
    },
    onEnd: async ({ responseMessage, outcome, isAborted }) => {
      try {
        const persisted = partsHaveText(responseMessage)
          ? responseMessage
          : accumulatedText.length > 0
            ? {
                ...responseMessage,
                parts: [{ type: "text" as const, text: accumulatedText }],
              }
            : responseMessage;

        let turnOutcome: ChatMessageOutcome = "completed";
        let errorMessage: string | null = null;
        if (isAborted) {
          turnOutcome = "stopped";
        } else if (outcome.status === "failed") {
          turnOutcome = "failed";
          errorMessage =
            streamErrorMessage ?? handle.describeError(outcome.error).message;
        }

        await appendAssistantMessage(
          {
            topicId,
            message: persisted,
            outcome: turnOutcome,
            errorMessage,
            providerConfigId: input.providerConfigId,
            modelId: input.modelId,
            reasoningMs: reasoningTimer.measure(),
            createdAt: streamStartedAt,
            groupId: targetGroupId ?? undefined,
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
    headers: { "x-pika-stream-id": streamId },
  });
});
