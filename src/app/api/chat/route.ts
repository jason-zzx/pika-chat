import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type ToolSet,
} from "ai";

import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { newId } from "@/lib/id";
import {
  chatRequestSchema,
  type ChatMessageOutcome,
  type ChatUIMessage,
} from "@/lib/schemas/chat";
import { createChatModelHandle } from "@/server/ai/chat-model";
import { registerStream, releaseStream } from "@/server/ai/stream-registry";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  appendAssistantMessage,
  appendUserMessage,
  listTopicMessages,
} from "@/server/services/message.service";
import {
  createTopicForChat,
  findTopicContextForActor,
  touchTopicUpdatedAt,
} from "@/server/services/topic.service";

function requestToUserMessage(message: {
  id: string;
  parts: Array<{ type: "text"; text: string }>;
}): ChatUIMessage {
  return {
    id: message.id,
    role: "user",
    parts: message.parts.map((part) => ({ type: "text", text: part.text })),
  };
}

function partsHaveText(message: ChatUIMessage): boolean {
  return message.parts.some(
    (part) => part.type === "text" && part.text.length > 0,
  );
}

export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = chatRequestSchema.parse(await request.json());

  // Before any topic row exists: an unusable model must not leave a draft behind.
  const handle = await createChatModelHandle(
    {
      providerConfigId: input.providerConfigId,
      modelId: input.modelId,
    },
    actor,
  );

  let topicId = input.topicId;
  let systemPrompt: string | null = null;

  if (topicId) {
    const context = await findTopicContextForActor(topicId, actor);
    if (!context || context.assistant.id !== input.assistantId) {
      throw new AppError("NOT_FOUND", 404, "Topic not found");
    }
    systemPrompt = context.assistant.systemPrompt;
  } else {
    const created = await createTopicForChat(
      { assistantId: input.assistantId },
      actor,
    );
    topicId = created.id;
    const context = await findTopicContextForActor(topicId, actor);
    systemPrompt = context?.assistant.systemPrompt ?? null;
  }

  const history = await listTopicMessages({ topicId }, actor);
  const userMessage = requestToUserMessage(input.message);
  const storedUser = await appendUserMessage(
    { topicId, message: userMessage },
    actor,
  );
  await touchTopicUpdatedAt(topicId, actor);

  const originalMessages: ChatUIMessage[] = [...history, storedUser];
  const modelMessages = await convertToModelMessages(originalMessages);

  const streamId = newId();
  const abortSignal = registerStream(streamId, actor.userId);

  logger.info(
    {
      userId: actor.userId,
      topicId,
      model: input.modelId,
      providerConfigId: input.providerConfigId,
    },
    "chat completion started",
  );

  let accumulatedText = "";
  let streamErrorMessage: string | null = null;
  const result = streamText({
    model: handle.model,
    messages: modelMessages,
    instructions: systemPrompt ?? undefined,
    abortSignal,
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
    },
  });

  void result.consumeStream();

  const persistedTopicId = topicId;
  const stream = createUIMessageStream<ChatUIMessage>({
    originalMessages,
    generateId: newId,
    execute: ({ writer }) => {
      writer.write({
        type: "data-topic",
        data: { topicId: persistedTopicId, streamId },
      });
      writer.merge(
        toUIMessageStream<ToolSet, ChatUIMessage>({
          stream: result.stream,
          originalMessages,
          generateMessageId: newId,
          sendStart: false,
          sendReasoning: false,
          messageMetadata: ({ part }) => {
            if (part.type !== "finish") {
              return undefined;
            }
            return {
              providerConfigId: input.providerConfigId,
              modelId: input.modelId,
              totalTokens: part.totalUsage.totalTokens,
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
            streamErrorMessage ??
            handle.describeError(outcome.error).message;
        }

        await appendAssistantMessage(
          {
            topicId: persistedTopicId,
            message: persisted,
            outcome: turnOutcome,
            errorMessage,
            providerConfigId: input.providerConfigId,
            modelId: input.modelId,
          },
          actor,
        );
        await touchTopicUpdatedAt(persistedTopicId, actor);
      } finally {
        releaseStream(streamId);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
});
