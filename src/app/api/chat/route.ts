import {
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
import { getTranslations } from "next-intl/server";
import { createChatModelHandle } from "@/server/ai/chat-model";
import {
  stripMarkupFromTextParts,
  stripToolCallMarkupTransform,
} from "@/server/ai/search/markup-sanitizer";
import {
  buildSearchTools,
  toolTurnStepSettings,
  withCitationDirective,
} from "@/server/ai/search/tool";
import { resolvedReasoningEffort } from "@/server/ai/reasoning-effort";
import { replayModelMessages } from "@/server/ai/model-messages";
import { resolvedMaxOutputTokens } from "@/server/ai/output-budget";
import { providerErrorText } from "@/server/ai/provider-error";
import {
  createReasoningTimer,
  withReasoningDurations,
} from "@/server/ai/reasoning-timer";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import { registerStream, releaseStream } from "@/server/ai/stream-registry";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  appendAssistantMessage,
  appendUserMessage,
  listTopicMessages,
} from "@/server/services/message.service";
import { resolveSearchProviderCredentials } from "@/server/services/search-provider.service";
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
  // Request-scoped translator for the streaming path: the stream can only
  // carry text, so our wrapper copy is localized here while upstream
  // provider detail stays verbatim (see provider-error.ts).
  const t = await getTranslations("Errors");
  const input = chatRequestSchema.parse(await request.json());

  // Before any topic row exists: an unusable model must not leave a draft behind.
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

  let topicId = input.topicId;
  let systemPrompt: string | null = null;

  if (topicId) {
    const context = await findTopicContextForActor(topicId, actor);
    if (!context || context.assistant.id !== input.assistantId) {
      throw new AppError("NOT_FOUND", 404, "topic.notFound");
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
  const modelMessages = await replayModelMessages(originalMessages);

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
  // Captured before the model call so the persisted assistant createdAt
  // matches what a history reload will return.
  const streamStartedAt = new Date();
  const reasoningTimer = createReasoningTimer();
  // Count of phase durations already announced via early message-metadata;
  // each newly closed reasoning phase re-emits the cumulative list.
  let emittedReasoningPhaseCount = 0;
  // Assigned from the UI stream's execute closure, where the writer exists.
  let emitReasoningMetadata: (() => void) | null = null;

  const result = streamText({
    model: handle.model,
    messages: modelMessages,
    // Tool-mode turns carry the citation directive (R14) so the model cites
    // sources inline as [n]; the forced final step's instructions override
    // retains it (appendForcedStepDirective appends, never replaces).
    instructions: searchTools
      ? withCitationDirective(systemPrompt ?? undefined)
      : (systemPrompt ?? undefined),
    abortSignal,
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
      // Emit each phase's duration as soon as that thinking phase ends so
      // the label updates before the whole stream finishes;
      // emitReasoningMetadata is a no-op until a phase has closed.
      emitReasoningMetadata?.();
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
          originalMessages,
          generateMessageId: newId,
          // sendStart must stay enabled: the start chunk carries the
          // server-generated message id to the client, so actions on the
          // message (regenerate/delete/select) reference the id the onEnd
          // persistence writes — with sendStart: false the client invents
          // its own id and the server 404s (B6). Only one stream is merged
          // here, so no duplicate start chunk is emitted.
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
              ...(reasoningTimer.durations().length > 0
                ? { reasoningDurations: reasoningTimer.durations() }
                : {}),
            };
          },
        }),
      );
    },
    onError: (error: unknown) => {
      streamErrorMessage = providerErrorText(handle.describeError(error), t);
      return streamErrorMessage;
    },
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
        } else if (outcome.status === "failed") {
          turnOutcome = "failed";
          errorMessage =
            streamErrorMessage ??
            providerErrorText(handle.describeError(outcome.error), t);
        }

        await appendAssistantMessage(
          {
            topicId: persistedTopicId,
            message: persisted,
            outcome: turnOutcome,
            errorMessage,
            providerConfigId: input.providerConfigId,
            modelId: input.modelId,
            reasoningMs: reasoningTimer.measure(),
            createdAt: streamStartedAt,
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
