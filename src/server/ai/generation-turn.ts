import "server-only";

import { createHash } from "node:crypto";

import {
  createUIMessageStream,
  streamText,
  toUIMessageStream,
  type ToolSet,
} from "ai";

import type { ErrorsTranslator } from "@/lib/api/error-contract";
import { isDefaultTopicTitle } from "@/i18n/defaults";
import type { Actor } from "@/server/auth/actor";
import type { ActorRole } from "@/lib/auth-hierarchy";
import type {
  ChatMessageOutcome,
  ChatRequest,
  ChatUIMessage,
  ImageGenerationParams,
} from "@/lib/schemas/chat";
import type { z } from "zod";
import type { regenerateMessageRequestSchema } from "@/lib/schemas/chat";
import { newId } from "@/lib/id";
import {
  assertAttachmentsRoutable,
  resolveAttachmentsForModel,
} from "@/server/ai/attachments";
import type { ChatChunk } from "@/server/ai/generation-stream";
import {
  assertImageGenerationSupported,
  resolveImageReferences,
} from "@/server/ai/image/turn";
import { buildChatInstructions } from "@/server/ai/instructions";
import { replayModelMessages } from "@/server/ai/model-messages";
import { resolvedMaxOutputTokens } from "@/server/ai/output-budget";
import { resolvedReasoningEffort } from "@/server/ai/reasoning-effort";
import { createReasoningTimer } from "@/server/ai/reasoning-timer";
import { requireModelForActor } from "@/server/ai/require-model";
import { isAbortError } from "@/server/ai/search/chain";
import { stripToolCallMarkupTransform } from "@/server/ai/search/markup-sanitizer";
import { buildSearchTools, toolTurnStepSettings } from "@/server/ai/search/tool";
import { createStreamFailureTracker } from "@/server/ai/stream-failure";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { resolveOwnedFileParts } from "@/server/files/file.service";
import {
  boundaryFromSummaryState,
  compressTopicHistory,
  exceedsCompressionThreshold,
  getTopicSummaryState,
  messagesAfterBoundary,
} from "@/server/services/compression.service";
import {
  generationActor,
  type GenerationRow,
  type PreparedTurn,
} from "@/server/services/generation.service";
import {
  loadMessagesByIds,
  textFromMessage,
} from "@/server/services/message.service";
import { resolveModelPreference } from "@/server/services/model-preferences.service";
import { resolveSearchProviderCredentials } from "@/server/services/search-provider.service";
import { findTopicContextForActor } from "@/server/services/topic.service";
import { requireOwnedAssistant } from "@/server/services/assistant.service";

/**
 * Turn preparation and execution for server-managed generations.
 *
 * `prepare*` runs at the HTTP boundary and performs every check that must fail
 * before a row is written (model availability, attachment routability, image
 * params, ownership, fixed history). `run*` runs in the background executor:
 * it owns the SDK consumption chain and reports the finished turn to the
 * runner, which persists it. The HTTP response is only a subscriber to that
 * chain — a browser disconnect never cancels it (chat task §3/§6).
 */

/** Stable digest of a canonical request payload (order-insensitive keys). */
export type RegenerateMessageRequest = z.infer<
  typeof regenerateMessageRequestSchema
>;

export function requestHashFor(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/**
 * Canonical digest of a send request (chat task §4).
 *
 * Exposed separately from `prepareSendTurn` because the HTTP entry has to know
 * the digest BEFORE preparation: a retry of an accepted request must find its
 * receipt without re-running model/attachment validation. Every field that
 * changes what the model is asked (including the browser time zone, which is
 * injected into the instructions) belongs in the digest.
 */
export function sendRequestHash(request: ChatRequest): string {
  return requestHashFor({
    kind: "send",
    assistantId: request.assistantId,
    topicId: request.topicId ?? null,
    providerConfigId: request.providerConfigId,
    modelId: request.modelId,
    reasoningEffort: request.reasoningEffort ?? null,
    searchMode: request.searchMode ?? "off",
    image: request.image ?? null,
    timeZone: request.timeZone ?? null,
    message: request.message,
  });
}

/** Canonical digest of an edit/regenerate request (same rules as send). */
export function regenerateRequestHash(input: {
  topicId: string;
  messageId: string;
  request: RegenerateMessageRequest;
}): string {
  const { request } = input;
  return requestHashFor({
    kind: request.edit ? "edit" : "regenerate",
    topicId: input.topicId,
    messageId: input.messageId,
    providerConfigId: request.providerConfigId,
    modelId: request.modelId,
    reasoningEffort: request.reasoningEffort ?? null,
    searchMode: request.searchMode ?? "off",
    image: request.image ?? null,
    timeZone: request.timeZone ?? null,
    edit: request.edit ?? null,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

/** Canonical user/edit message as it is admitted and later replayed. */
function userMessageFrom(
  message: { id: string },
  parts: ChatUIMessage["parts"],
): { id: string; role: "user"; parts: ChatUIMessage["parts"] } {
  return {
    id: message.id,
    role: "user",
    parts,
  };
}

/**
 * Send/edit path: validate the model and every attachment, resolve the topic
 * and freeze the history ids the turn will run against.
 */
export async function prepareSendTurn(
  input: {
    request: ChatRequest;
    defaultTopicTitle: string;
    actorRole: ActorRole;
    locale?: string;
  },
  actor: Actor,
): Promise<PreparedTurn> {
  const { request } = input;
  const { selected, handle } = await requireModelForActor(
    { providerConfigId: request.providerConfigId, modelId: request.modelId },
    actor,
    { builtinSearch: request.searchMode === "builtin" },
  );
  const isImage = selected.outputModalities.includes("image");
  // The assistant's instructions are frozen with the task: the executor must
  // not read mutable configuration after admission (chat task §4).
  const assistant = await requireOwnedAssistant(request.assistantId, actor);
  const systemPrompt = assistant.systemPrompt;

  const fileParts = request.message.parts.filter(
    (part) => part.type === "file",
  );
  const textParts = request.message.parts.filter(
    (part) => part.type === "text",
  );
  let canonicalParts: ChatUIMessage["parts"];
  if (isImage) {
    const { parts } = await resolveImageReferences(
      fileParts,
      actor,
      request.modelId,
    );
    assertImageGenerationSupported(handle.apiFormat, request.modelId, request.image);
    canonicalParts = [...parts, ...textParts];
  } else {
    const owned = await resolveOwnedFileParts(fileParts, actor);
    canonicalParts = [...owned, ...textParts];
  }
  // What gets persisted (and later replayed) is the CANONICAL message: attachment
  // parts rebuilt from the files table carry the authoritative mediaType,
  // filename and size, not whatever the browser claimed.
  const userMessage = userMessageFrom(request.message, canonicalParts);

  const topicId = request.topicId ?? null;
  let historyMessageIds: string[] = [];
  let titleCandidate = true;
  let summary: PreparedTurn["summary"] = null;

  if (topicId !== null) {
    const context = await findTopicContextForActor(topicId, actor);
    if (!context || context.assistant.id !== request.assistantId) {
      throw new AppError("NOT_FOUND", 404, "topic.notFound");
    }
    titleCandidate = isDefaultTopicTitle(context.topic.title);
    historyMessageIds = await listHistoryIds(topicId, actor);

    if (!isImage) {
      // Capability gate for the whole context — a historical attachment that
      // the current model cannot consume must fail before any write. Only the
      // messages that are actually sent count: everything the persisted
      // summary already covers is clipped away first.
      const summaryState = await getTopicSummaryState(topicId, actor);
      summary = summaryOf(summaryState);
      const history = await loadMessagesByIds(
        { topicId, ids: historyMessageIds },
        actor,
      );
      const modelHistory = messagesAfterBoundary(
        history,
        boundaryFromSummaryState(summaryState),
      );
      await assertAttachmentsRoutable([...modelHistory, userMessage], {
        inputModalities: selected.inputModalities,
        apiFormat: handle.apiFormat,
        providerConfigId: handle.providerConfigId,
        filesApi: handle.filesApi,
      });
    } else {
      summary = summaryOf(await getTopicSummaryState(topicId, actor));
    }
  } else if (!isImage) {
    await assertAttachmentsRoutable([userMessage], {
      inputModalities: selected.inputModalities,
      apiFormat: handle.apiFormat,
      providerConfigId: handle.providerConfigId,
      filesApi: handle.filesApi,
    });
  }

  return {
    kind: "send",
    assistantId: request.assistantId,
    topicId,
    providerConfigId: request.providerConfigId,
    modelId: request.modelId,
    reasoningEffort: request.reasoningEffort,
    searchMode: request.searchMode,
    image: request.image,
    timeZone: request.timeZone,
    historyMessageIds,
    userMessage: { message: userMessage },
    defaultTopicTitle: input.defaultTopicTitle,
    titleCandidate,
    actorRole: input.actorRole,
    locale: input.locale,
    systemPrompt,
    summary,
    requestHash: sendRequestHash(request),
  };
}

/** Frozen compression snapshot carried by `PreparedTurn`. */
function summaryOf(
  state: Awaited<ReturnType<typeof getTopicSummaryState>>,
): PreparedTurn["summary"] {
  if (!state) {
    return null;
  }
  return {
    text: state.summaryText,
    boundaryMessageId: state.summaryUpToMessageId,
    boundaryGroupId: state.summaryUpToGroupId,
  };
}

/**
 * Regenerate/edit path: same validation, plus the version-group target the new
 * answer joins. An edit's user version is persisted at admission, so the frozen
 * history is the context BEFORE the edited message — the edit itself is
 * appended by the executor exactly once, like a newly sent message.
 */
export async function prepareRegenerateTurn(
  input: {
    topicId: string;
    messageId: string;
    request: RegenerateMessageRequest;
    defaultTopicTitle: string;
    actorRole: ActorRole;
    locale?: string;
  },
  actor: Actor,
): Promise<PreparedTurn> {
  const { request, topicId, messageId } = input;
  const { selected, handle } = await requireModelForActor(
    { providerConfigId: request.providerConfigId, modelId: request.modelId },
    actor,
    { builtinSearch: request.searchMode === "builtin" },
  );
  const isImage = selected.outputModalities.includes("image");

  const topicContext = await findTopicContextForActor(topicId, actor);
  if (!topicContext) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  const summaryState = await getTopicSummaryState(topicId, actor);
  const summary = summaryOf(summaryState);

  const resolved = await resolveRegeneratePlan(topicId, messageId, actor);
  const targetGroupId = resolved.targetGroupId;
  let historyIds = resolved.historyIds;
  const detachedAnchor = resolved.targetGroupCreatedAt;
  let versionOfGroupId: string | undefined;
  let userMessage: PreparedTurn["userMessage"];
  let editParts: ChatUIMessage["parts"] | null = null;

  const edit = request.edit;
  if (edit) {
    if (resolved.targetRole !== "user") {
      throw new AppError("VALIDATION_FAILED", 400, "message.editTargetNotUser");
    }
    const owned = await resolveOwnedFileParts(
      edit.parts.filter((part) => part.type === "file"),
      actor,
    );
    // Canonical parts: the persisted edit version carries the files-table
    // identity of every attachment, not the browser-reported one.
    editParts = [...owned, ...edit.parts.filter((part) => part.type === "text")];
    // The edit becomes the selected version of the clicked user group. The
    // frozen history is the context BEFORE that message, and the edit itself is
    // appended by the executor — exactly once, never twice. The entry to drop
    // is the group's SELECTED row, which is not necessarily the clicked id.
    const replaced = resolved.historyMemberOfTargetGroup ?? messageId;
    historyIds = historyIds.filter((id) => id !== replaced);
    versionOfGroupId = resolved.targetOwnGroupId;
    userMessage = {
      message: userMessageFrom(edit, editParts),
      versionOfGroupId,
    };
  }

  if (isImage) {
    // The prompt source is the message the image turn will read: the edit when
    // there is one, otherwise the last user message of the frozen history.
    const promptParts =
      editParts ?? (await lastUserParts(topicId, historyIds, actor));
    // Reference images are resolved BEFORE any write (chat task §4 step 3): a
    // deleted source image or a model without reference-image input must fail
    // while the topic still has no placeholder and no version was switched.
    await resolveImageReferences(
      promptParts.filter((part) => part.type === "file"),
      actor,
      request.modelId,
    );
    assertImageGenerationSupported(handle.apiFormat, request.modelId, request.image);
  } else {
    const contextMessages = await loadMessagesByIds(
      { topicId, ids: historyIds },
      actor,
    );
    // Only what is actually sent decides routability: the persisted summary
    // clips the history first, so an attachment that is no longer part of the
    // payload cannot reject an otherwise valid turn.
    const modelHistory = messagesAfterBoundary(
      contextMessages,
      boundaryFromSummaryState(summaryState),
    );
    const editMessage: ChatUIMessage[] =
      userMessage === undefined || editParts === null
        ? []
        : [
            {
              id: userMessage.message.id,
              role: "user",
              parts: editParts,
            },
          ];
    await assertAttachmentsRoutable([...modelHistory, ...editMessage], {
      inputModalities: selected.inputModalities,
      apiFormat: handle.apiFormat,
      providerConfigId: handle.providerConfigId,
      filesApi: handle.filesApi,
    });
  }

  return {
    kind: request.edit ? "edit" : "regenerate",
    assistantId: topicContext.assistant.id,
    topicId,
    providerConfigId: request.providerConfigId,
    modelId: request.modelId,
    reasoningEffort: request.reasoningEffort,
    searchMode: request.searchMode,
    image: request.image,
    timeZone: request.timeZone,
    historyMessageIds: historyIds,
    userMessage,
    targetMessageId: messageId,
    assistantGroupId: targetGroupId ?? undefined,
    assistantGroupCreatedAt: targetGroupId === null ? detachedAnchor : undefined,
    defaultTopicTitle: input.defaultTopicTitle,
    // The turn may name the topic only while it still carries the sentinel
    // title; a user rename wins (chat task §7).
    titleCandidate: isDefaultTopicTitle(topicContext.topic.title),
    actorRole: input.actorRole,
    locale: input.locale,
    systemPrompt: topicContext.assistant.systemPrompt,
    summary,
    requestHash: regenerateRequestHash({ topicId, messageId, request }),
  };
}

/** Parts of the last user message in the frozen history (image prompt source). */
async function lastUserParts(
  topicId: string,
  historyIds: string[],
  actor: Actor,
): Promise<ChatUIMessage["parts"]> {
  if (historyIds.length === 0) {
    return [];
  }
  const history = await loadMessagesByIds({ topicId, ids: historyIds }, actor);
  const lastUser = [...history].reverse().find((message) => message.role === "user");
  return lastUser?.parts ?? [];
}

// --- Execution -------------------------------------------------------------

export type TurnFinalizeInput = {
  outcome: ChatMessageOutcome;
  errorMessage: string | null;
  /**
   * Parts produced by this turn, for cleanup decisions on a deleted target.
   *
   * The text path deliberately omits `parts`: the answer is assembled by the
   * single `applyChunk` reducer in the executor. The image path owns its own
   * assembly because the UI `file` chunk carries no filename, and the persisted
   * attachment card needs it.
   */
  parts?: ChatUIMessage["parts"];
  /** Generated image urls, reclaimed when the batch cannot be stored. */
  generatedFileUrls?: string[];
};

export type TurnHooks = {
  /** Cancellation of the whole turn (explicit stop / target deletion). */
  signal: AbortSignal;
  /** Every produced UI chunk, in production order. */
  onChunk: (chunk: ChatChunk) => void;
  /** Persists the finished turn and closes the generation. */
  finalize: (input: TurnFinalizeInput) => Promise<void>;
  /** Locale-captured error translator (no request scope in the background). */
  t: ErrorsTranslator;
};

/** Drains the turn's UI stream through the runner's sole chunk accumulator. */
async function pump(
  stream: ReadableStream<ChatChunk>,
  hooks: TurnHooks,
): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      hooks.onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Runs the turn for an admitted generation. The caller (runner) has already
 * claimed the row (queued → running) and owns finalize/checkpoint bookkeeping.
 */
export async function runGenerationTurn(
  row: GenerationRow,
  hooks: TurnHooks,
): Promise<void> {
  const input = row.input;
  const topicId = row.topicId;
  if (!input || topicId === null) {
    throw new AppError("INTERNAL", 500, "generation.notFound");
  }
  const actor = generationActor(row);
  const resolvedModel = await requireModelForActor(
    { providerConfigId: input.providerConfigId, modelId: input.modelId },
    actor,
    { builtinSearch: input.searchMode === "builtin" },
  );
  const { selected, handle } = resolvedModel;
  if (selected.outputModalities.includes("image")) {
    const { runImageTurn } = await import("@/server/ai/image/turn");
    // An image turn uses no history as context: the prompt is the last user
    // message of the frozen turn (the edit version when there is one) and its
    // file parts are the reference images.
    const contextIds = input.userMessageId
      ? [...input.historyMessageIds, input.userMessageId]
      : input.historyMessageIds;
    const contextMessages = await loadMessagesByIds(
      { topicId, ids: contextIds },
      actor,
    );
    const promptMessage = [...contextMessages]
      .reverse()
      .find((message) => message.role === "user");
    const { references } = await resolveImageReferences(
      promptMessage?.parts.filter((part) => part.type === "file") ?? [],
      actor,
      input.modelId,
    );
    await runImageTurn(
      {
        actor,
        handle,
        providerConfigId: input.providerConfigId,
        modelId: input.modelId,
        image: input.image as ImageGenerationParams | undefined,
        prompt: promptMessage ? textFromMessage(promptMessage) : "",
        references,
        topicId,
        messageId: row.assistantMessageId ?? "",
        signal: hooks.signal,
      },
      hooks,
    );
    return;
  }
  await runTextTurn(row, hooks, resolvedModel);
}

async function runTextTurn(
  row: GenerationRow,
  hooks: TurnHooks,
  resolvedModel: Awaited<ReturnType<typeof requireModelForActor>>,
): Promise<void> {
  const input = row.input;
  const topicId = row.topicId;
  if (!input || topicId === null || row.assistantMessageId === null) {
    throw new AppError("INTERNAL", 500, "generation.notFound");
  }
  const actor = generationActor(row);
  const t = hooks.t;
  const searchMode = input.searchMode ?? "off";

  const { selected, handle } = resolvedModel;
  const reasoningEffort = resolvedReasoningEffort(
    selected,
    input.reasoningEffort,
  );

  const context = await findTopicContextForActor(topicId, actor);
  if (!context) {
    // Deleted between admission and start: nothing to generate into.
    await hooks.finalize({
      outcome: "stopped",
      errorMessage: null,
    });
    return;
  }

  // Tool mode credentials are resolved per turn; a missing provider degrades
  // to a tool-less run exactly as on the request path.
  let searchTools: ReturnType<typeof buildSearchTools> | null = null;
  if (searchMode === "tool") {
    const credentials = await resolveSearchProviderCredentials(actor);
    if (credentials.length > 0) {
      searchTools = buildSearchTools(credentials);
    } else {
      logger.info(
        { userId: actor.userId, generationId: row.id },
        "search mode 'tool' requested without configured providers; running without tools",
      );
    }
  }

  const contextIds = input.userMessageId
    ? [...input.historyMessageIds, input.userMessageId]
    : input.historyMessageIds;
  const contextMessages = await loadMessagesByIds(
    { topicId, ids: contextIds },
    actor,
  );
  const userMessage = input.userMessageId
    ? contextMessages[contextMessages.length - 1]
    : undefined;
  const history = input.userMessageId
    ? contextMessages.slice(0, -1)
    : contextMessages;

  // The summary and instructions the turn was planned against are FROZEN on
  // the task (chat task §4): a manual compaction that commits mid-turn, or a
  // system-prompt edit, must not silently change this answer's context.
  const frozenBoundary = input.summary?.boundaryMessageId
    ? {
        id: input.summary.boundaryMessageId,
        groupId: input.summary.boundaryGroupId,
      }
    : null;
  let historySummary = input.summary?.text ?? null;
  let modelHistory = messagesAfterBoundary(history, frozenBoundary);

  // Auto-compression (PRD R1): only a send/edit introduces new history, and a
  // failed summary must not block the turn — the persisted summary and the
  // post-boundary history stay in effect (AC6).
  if (
    userMessage !== undefined &&
    modelHistory.length > 0 &&
    exceedsCompressionThreshold(
      [...modelHistory, userMessage],
      selected.contextTokens,
    )
  ) {
    try {
      const preferencePair = await resolveModelPreference(actor, "compression");
      const compressionHandle = preferencePair
        ? (await requireModelForActor(preferencePair, actor)).handle
        : handle;
      const compressed = await compressTopicHistory(
        {
          topicId,
          handle: compressionHandle,
          signal: hooks.signal,
          // Exactly the frozen pre-turn history, so this turn's own user
          // message and empty placeholder never enter the summary, and the
          // turn is not refused by its own active generation row.
          history: modelHistory,
          exceptGenerationId: row.id,
        },
        actor,
      );
      historySummary = compressed.summaryText;
      modelHistory = messagesAfterBoundary(modelHistory, {
        id: compressed.summaryUpToMessageId,
        groupId: compressed.summaryUpToGroupId,
      });
    } catch (caught) {
      // A cancelled turn stops here: "compression failed" must never degrade
      // into continuing the turn after an explicit stop or a topic delete
      // (chat task §7).
      if (hooks.signal.aborted || isAbortError(caught)) {
        throw caught;
      }
      logger.warn(
        {
          topicId,
          generationId: row.id,
          errorName: caught instanceof Error ? caught.name : undefined,
        },
        "history compression failed; continuing with the persisted summary",
      );
    }
  }

  const routed = await resolveAttachmentsForModel(
    userMessage ? [...modelHistory, userMessage] : modelHistory,
    {
      inputModalities: selected.inputModalities,
      apiFormat: handle.apiFormat,
      providerConfigId: handle.providerConfigId,
      filesApi: handle.filesApi,
    },
  );
  const modelMessages = await replayModelMessages(routed);

  const originalMessages: ChatUIMessage[] = userMessage
    ? [...history, userMessage]
    : history;
  const assistantMessageId = row.assistantMessageId;
  const failure = createStreamFailureTracker(handle.describeError, t);
  const reasoningTimer = createReasoningTimer();
  let emittedReasoningPhaseCount = 0;
  let emitReasoningMetadata: (() => void) | null = null;
  // Turn-start time from the app clock; the placeholder row was written with
  // admission time, so the final metadata reuses the row's own createdAt.
  const startedAt = row.createdAt;

  logger.info(
    {
      userId: actor.userId,
      generationId: row.id,
      topicId,
      model: input.modelId,
      kind: row.kind,
    },
    "generation turn started",
  );

  const result = streamText({
    model: handle.model,
    messages: modelMessages,
    instructions: buildChatInstructions({
      systemPrompt: input.systemPrompt ?? null,
      searchEnabled: searchTools !== null,
      timeZone: input.timeZone,
      historySummary,
    }),
    abortSignal: hooks.signal,
    // One retry, not the SDK default of two: the backoff doubles otherwise.
    maxRetries: 1,
    maxOutputTokens: resolvedMaxOutputTokens(selected),
    providerOptions:
      reasoningEffort === undefined
        ? undefined
        : { openaiCompatible: { reasoningEffort } },
    ...(searchTools
      ? {
          tools: searchTools,
          ...toolTurnStepSettings(),
          experimental_transform: stripToolCallMarkupTransform(),
        }
      : {}),
    onError: ({ error }) => {
      logger.error(
        {
          topicId,
          generationId: row.id,
          errorName: error instanceof Error ? error.name : undefined,
        },
        "streamText failed",
      );
    },
    onChunk: ({ chunk }) => {
      reasoningTimer.onChunk(chunk);
      emitReasoningMetadata?.();
    },
  });

  void result.consumeStream();

  const stream = createUIMessageStream<ChatUIMessage>({
    originalMessages,
    generateId: newId,
    execute: ({ writer }) => {
      if (!assistantMessageId) {
        return;
      }
      // Mid-stream metadata REPLACES what the client already holds (AI SDK
      // message-metadata semantics), so a partial emission must still carry
      // every stable field — most importantly the message created time, which
      // anchors ordering, and the model identity.
      const liveMetadata = () => ({
        providerConfigId: input.providerConfigId,
        modelId: input.modelId,
        createdAt: startedAt.toISOString(),
        reasoningMs: reasoningTimer.measure(),
      });
      emitReasoningMetadata = () => {
        const reasoningDurations = reasoningTimer.durations();
        if (reasoningDurations.length === emittedReasoningPhaseCount) {
          return;
        }
        emittedReasoningPhaseCount = reasoningDurations.length;
        writer.write({
          type: "message-metadata",
          messageMetadata: { ...liveMetadata(), reasoningDurations },
        });
      };
      writer.merge(
        toUIMessageStream<ToolSet, ChatUIMessage>({
          stream: result.stream,
          originalMessages,
          // The start chunk must carry the placeholder id so the client
          // replaces that row in place — live, on resume, and after reload.
          generateMessageId: () => assistantMessageId,
          sendStart: true,
          sendReasoning: true,
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
              createdAt: startedAt.toISOString(),
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
  });

  // No UI-message onEnd callback: the SDK otherwise builds another complete
  // message through processUIMessageStream even if we ignore responseMessage.
  // Drain first, then finalize from the runner's sole chunk accumulator.
  await pump(stream, hooks);
  await hooks.finalize({
    outcome: hooks.signal.aborted
      ? "stopped"
      : failure.sawFailure ? "failed" : "completed",
    errorMessage: hooks.signal.aborted ? null : failure.message,
  });
}

/** Loads the selected-version message ids of a topic, oldest first. */
async function listHistoryIds(
  topicId: string,
  actor: Actor,
): Promise<string[]> {
  const { listTopicMessages } = await import("@/server/services/message.service");
  const messages = await listTopicMessages({ topicId }, actor);
  return messages.map((message) => message.id);
}

type RegeneratePlan = {
  targetGroupId: string | null;
  historyIds: string[];
  targetRole: "user" | "assistant";
  targetOwnGroupId: string;
  targetGroupCreatedAt: Date;
  /**
   * The clicked message's own group as it appears in the frozen history (its
   * SELECTED row). An edit replaces that entry, so it has to be dropped even
   * when the client clicked a non-selected version.
   */
  historyMemberOfTargetGroup: string | null;
};

async function resolveRegeneratePlan(
  topicId: string,
  messageId: string,
  actor: Actor,
): Promise<RegeneratePlan> {
  const { resolveRegenerateTarget } = await import(
    "@/server/services/message.service"
  );
  const resolved = await resolveRegenerateTarget({ topicId, messageId }, actor);
  const member = resolved.history.find(
    (message) =>
      (message.metadata?.groupId ?? message.id) === resolved.target.groupId,
  );
  return {
    targetGroupId: resolved.targetGroupId,
    historyIds: resolved.history.map((message) => message.id),
    targetRole: resolved.target.role,
    targetOwnGroupId: resolved.target.groupId,
    targetGroupCreatedAt: resolved.target.groupCreatedAt,
    historyMemberOfTargetGroup: member?.id ?? null,
  };
}
