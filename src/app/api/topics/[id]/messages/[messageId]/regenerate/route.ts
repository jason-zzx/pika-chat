import {
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
import { resolveAttachmentsForModel } from "@/server/ai/attachments";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import { replayModelMessages } from "@/server/ai/model-messages";
import { resolvedMaxOutputTokens } from "@/server/ai/output-budget";
import { resolvedReasoningEffort } from "@/server/ai/reasoning-effort";
import {
  createReasoningTimer,
  withReasoningDurations,
} from "@/server/ai/reasoning-timer";
import {
  stripMarkupFromTextParts,
  stripToolCallMarkupTransform,
} from "@/server/ai/search/markup-sanitizer";
import {
  buildSearchTools,
  toolTurnStepSettings,
} from "@/server/ai/search/tool";
import { buildChatInstructions } from "@/server/ai/instructions";
import { createStreamFailureTracker } from "@/server/ai/stream-failure";
import { registerStream, releaseStream } from "@/server/ai/stream-registry";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getTranslations } from "next-intl/server";
import {
  appendAssistantMessage,
  resolveRegenerateTarget,
} from "@/server/services/message.service";
import { resolveSearchProviderCredentials } from "@/server/services/search-provider.service";
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
  // Request-scoped translator for the streaming path (see /api/chat).
  const t = await getTranslations("Errors");
  const topicId = await requireParam(context, "id", "topic.notFound");
  const messageId = await requireParam(context, "messageId", "message.notFound");
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
      "model.notAvailable",
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
    { builtinSearch: input.searchMode === "builtin" },
  );

  // Tool mode: resolve the caller's search credentials once per request. With
  // none configured the turn degrades gracefully to a tool-less run.
  const searchMode = input.searchMode ?? "off";
  let searchTools: ReturnType<typeof buildSearchTools> | null = null;
  if (searchMode === "tool") {
    const credentials = await resolveSearchProviderCredentials(actor);
    if (credentials.length > 0) {
      searchTools = buildSearchTools(credentials);
    } else {
      logger.info(
        { userId: actor.userId },
        "search mode 'tool' requested without configured providers; running without tools",
      );
    }
  }

  const topicContext = await findTopicContextForActor(topicId, actor);
  if (!topicContext) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }

  const { targetGroupId, history } = await resolveRegenerateTarget(
    { topicId, messageId },
    actor,
  );
  // Regeneration runs on the composer's current model, so historical
  // attachments are re-routed here: switching to a text-only model degrades a
  // PDF to its cached extraction, switching to a vision model inlines images.
  const modelMessages = await replayModelMessages(
    await resolveAttachmentsForModel(history, {
      inputModalities: selected.inputModalities,
      apiFormat: handle.apiFormat,
      providerConfigId: handle.providerConfigId,
      filesApi: handle.filesApi,
    }),
  );

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
  // Captured before the model call so the persisted assistant createdAt
  // matches what a history reload will return.
  const streamStartedAt = new Date();
  const reasoningTimer = createReasoningTimer();
  // Count of phase durations already announced via early message-metadata;
  // each newly closed reasoning phase re-emits the cumulative list.
  let emittedReasoningPhaseCount = 0;
  // Assigned from the UI stream's execute closure, where the writer exists.
  let emitReasoningMetadata: (() => void) | null = null;
  // Decides the turn outcome from what we observe, not from what the SDK
  // declares — see stream-failure.ts.
  const failure = createStreamFailureTracker(handle.describeError, t);

  const result = streamText({
    model: handle.model,
    messages: modelMessages,
    // Current date + tool-mode directives (see ai/instructions.ts).
    instructions: buildChatInstructions({
      systemPrompt: topicContext.assistant.systemPrompt,
      searchEnabled: searchTools !== null,
      timeZone: input.timeZone,
    }),
    abortSignal,
    // One retry, not the SDK default of two: the backoff doubles otherwise.
    maxRetries: 1,
    maxOutputTokens: resolvedMaxOutputTokens(selected),
    providerOptions:
      reasoningEffort === undefined
        ? undefined
        : {
            openaiCompatible: { reasoningEffort },
          },
    ...(searchTools
      ? {
          tools: searchTools,
          ...toolTurnStepSettings(),
          // R9 sanitization: strip Hermes-style tool-call markup weak
          // models leak as plain text (the forced answer step especially).
          experimental_transform: stripToolCallMarkupTransform(),
        }
      : {}),
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
        const reasoningDurations = reasoningTimer.durations();
        if (reasoningDurations.length === emittedReasoningPhaseCount) {
          return;
        }
        emittedReasoningPhaseCount = reasoningDurations.length;
        writer.write({
          type: "message-metadata",
          messageMetadata: { reasoningDurations },
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
          // Without this the client receives the SDK's own "An error occurred."
          // and the provider detail never leaves the server, even though we
          // computed it for the persisted row.
          onError: (error: unknown) => failure.describe(error),
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
              ...(reasoningTimer.durations().length > 0
                ? { reasoningDurations: reasoningTimer.durations() }
                : {}),
            };
          },
        }),
      );
    },
    onError: (error: unknown) => failure.describe(error),
    onEnd: async ({ responseMessage, outcome, isAborted }) => {
      try {
        const withText = partsHaveText(responseMessage)
          ? responseMessage
          : accumulatedText.length > 0
            ? {
                ...responseMessage,
                parts: [{ type: "text" as const, text: accumulatedText }],
              }
            : responseMessage;
        // R9 persistence safety net: the live transform already strips
        // leaked tool-call markup; re-run it here and drop text parts that
        // sanitize to nothing so markup never reaches the DB.
        const cleaned = searchTools
          ? { ...withText, parts: stripMarkupFromTextParts(withText.parts) }
          : withText;
        // Zip per-phase reasoning durations into the reasoning parts so the
        // per-step Thought durations survive reloads (parts jsonb, no
        // dedicated column); the reasoningMs column keeps the total.
        const persisted = {
          ...cleaned,
          parts: withReasoningDurations(
            cleaned.parts,
            reasoningTimer.durations(),
          ),
        };

        let turnOutcome: ChatMessageOutcome = "completed";
        let errorMessage: string | null = null;
        if (isAborted) {
          turnOutcome = "stopped";
        } else if (failure.sawFailure || outcome.status === "failed") {
          turnOutcome = "failed";
          errorMessage =
            failure.message ??
            (outcome.status === "failed"
              ? failure.describe(outcome.error)
              : null);
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
