import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireActor,
  resolveAvailableModels,
  resolveOwnedFileParts,
  createChatModelHandle,
  resolveAttachmentsForModel,
  appendUserMessage,
  appendAssistantMessage,
  listTopicMessages,
  findTopicContextForActor,
  touchTopicUpdatedAt,
  resolveSearchProviderCredentials,
  createTopicForChat,
  getTopicSummaryState,
  compressTopicHistory,
} = vi.hoisted(() => ({
  requireActor: vi.fn(),
  resolveAvailableModels: vi.fn(),
  resolveOwnedFileParts: vi.fn(),
  createChatModelHandle: vi.fn(),
  resolveAttachmentsForModel: vi.fn(),
  appendUserMessage: vi.fn(),
  appendAssistantMessage: vi.fn(),
  listTopicMessages: vi.fn(),
  findTopicContextForActor: vi.fn(),
  touchTopicUpdatedAt: vi.fn(),
  resolveSearchProviderCredentials: vi.fn(),
  createTopicForChat: vi.fn(),
  getTopicSummaryState: vi.fn(),
  compressTopicHistory: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/ai/model-resolution", () => ({ resolveAvailableModels }));
vi.mock("@/server/files/file.service", () => ({ resolveOwnedFileParts }));
vi.mock("@/server/ai/chat-model", () => ({ createChatModelHandle }));
vi.mock("@/server/ai/attachments", () => ({ resolveAttachmentsForModel }));
vi.mock("@/server/services/message.service", () => ({
  appendUserMessage,
  appendAssistantMessage,
  listTopicMessages,
}));
vi.mock("@/server/services/topic.service", () => ({
  createTopicForChat,
  findTopicContextForActor,
  touchTopicUpdatedAt,
}));
vi.mock("@/server/services/search-provider.service", () => ({
  resolveSearchProviderCredentials,
}));
// Keep the real token-estimation and boundary logic; stub only the two
// database-touching functions.
vi.mock("@/server/services/compression.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/services/compression.service")>();
  return { ...actual, getTopicSummaryState, compressTopicHistory };
});
vi.mock("@/server/ai/search/tool", () => ({
  buildSearchTools: vi.fn(),
  toolTurnStepSettings: vi.fn(() => ({})),
}));
vi.mock("@/server/ai/search/markup-sanitizer", () => ({
  stripMarkupFromTextParts: vi.fn((parts: unknown) => parts),
  stripToolCallMarkupTransform: vi.fn(() => undefined),
}));
vi.mock("@/server/ai/reasoning-timer", () => ({
  createReasoningTimer: vi.fn(() => ({
    onChunk: vi.fn(),
    durations: () => [],
    measure: () => 0,
  })),
  withReasoningDurations: vi.fn((parts: unknown) => parts),
}));
vi.mock("@/server/ai/output-budget", () => ({
  resolvedMaxOutputTokens: vi.fn(() => 1000),
}));
vi.mock("@/server/ai/provider-error", () => ({
  // Faithful passthrough so a test can assert the text the user actually sees.
  providerErrorText: vi.fn(
    (description: { kind: string; messageKey?: string; message?: string }) =>
      description.kind === "verbatim"
        ? description.message
        : description.messageKey,
  ),
}));
vi.mock("@/server/ai/model-messages", () => ({
  replayModelMessages: vi.fn(async (messages: unknown) => messages),
}));
const streamTextOptions = vi.hoisted(() => ({
  current: undefined as unknown,
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: (options: Parameters<typeof actual.streamText>[0]) => {
      streamTextOptions.current = options;
      return actual.streamText(options);
    },
  };
});
vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { APICallError } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";

import { AppError } from "@/server/errors";

import { POST } from "./route";

const ACTOR = { userId: "user-1", role: "user" as const };

const FILE_PART = {
  type: "file",
  url: "/api/files/file-1",
  mediaType: "application/pdf",
  filename: "scan.pdf",
};

function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(ACTOR);
  resolveAvailableModels.mockResolvedValue([
    {
      configId: "cfg-1",
      modelId: "model-1",
      inputModalities: ["text"],
      reasoning: false,
      reasoningOptions: [],
    },
  ]);
  resolveOwnedFileParts.mockResolvedValue([FILE_PART]);
  createChatModelHandle.mockResolvedValue({
    model: {},
    describeError: () => ({ kind: "key", key: "generic" }),
  });
  findTopicContextForActor.mockResolvedValue({
    assistant: { id: "assistant-1", systemPrompt: null },
  });
  listTopicMessages.mockResolvedValue([]);
  resolveSearchProviderCredentials.mockResolvedValue([]);
  resolveAttachmentsForModel.mockReset();
  getTopicSummaryState.mockResolvedValue(null);
});

describe("POST /api/chat attachment routing", () => {
  it("fails without persisting the user message when an attachment cannot be routed", async () => {
    resolveAttachmentsForModel.mockRejectedValue(
      new AppError("VALIDATION_FAILED", 400, "file.noTextLayer"),
    );

    const response = await POST(
      chatRequest({
        assistantId: "assistant-1",
        topicId: "topic-1",
        providerConfigId: "cfg-1",
        modelId: "model-1",
        message: { id: "message-1", role: "user", parts: [FILE_PART] },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "file.noTextLayer" },
    });
    // Routing ran against the not-yet-persisted message, and the failure
    // short-circuited persistence so the topic is not wedged for later sends.
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "message-1",
          role: "user",
          parts: [FILE_PART],
        }),
      ],
      { inputModalities: ["text"] },
    );
    expect(appendUserMessage).not.toHaveBeenCalled();
  });

  it("does not create a topic when a new topic's attachment cannot be routed", async () => {
    resolveAttachmentsForModel.mockRejectedValue(
      new AppError("VALIDATION_FAILED", 400, "file.noTextLayer"),
    );

    const response = await POST(
      chatRequest({
        assistantId: "assistant-1",
        providerConfigId: "cfg-1",
        modelId: "model-1",
        message: { id: "message-1", role: "user", parts: [FILE_PART] },
      }),
    );

    expect(response.status).toBe(400);
    // Routing ran against empty history before the topic row existed, so the
    // failed turn leaves neither a message nor an empty topic behind.
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "message-1",
          role: "user",
          parts: [FILE_PART],
        }),
      ],
      { inputModalities: ["text"] },
    );
    expect(createTopicForChat).not.toHaveBeenCalled();
    expect(listTopicMessages).not.toHaveBeenCalled();
    expect(appendUserMessage).not.toHaveBeenCalled();
  });
});

const PROVIDER_MESSAGE = "model_not_found: model does not exist";

/** A model whose provider call fails after the stream has opened. */
function failingModel(error: unknown) {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId: "model-1",
    supportedUrls: {},
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.error(error);
        },
      }),
    }),
  };
}

describe("POST /api/chat provider failure", () => {
  beforeEach(() => {
    resolveAttachmentsForModel.mockResolvedValue([]);
    resolveOwnedFileParts.mockResolvedValue([]);
    createChatModelHandle.mockResolvedValue({
      model: failingModel(
        new APICallError({
          message: "Bad Request",
          url: "https://provider.test/v1/chat/completions",
          requestBodyValues: {},
          statusCode: 400,
          responseBody: JSON.stringify({
            error: { code: "model_not_found", message: "model does not exist" },
          }),
        }),
      ),
      describeError: () => ({
        code: "PROVIDER_ERROR",
        kind: "verbatim",
        message: PROVIDER_MESSAGE,
      }),
      apiFormat: "openai-compatible",
      providerConfigId: "cfg-1",
      filesApi: null,
    });
  });

  // Regression: the SDK reports a fatal stream error to onEnd as
  // `{ status: "unknown" }`, so a turn keyed on `outcome.status === "failed"`
  // was persisted as `completed` with no error message — the transcript then
  // lost the reason on reload and the bubble rendered empty.
  it("persists a failed turn with the provider error instead of a silent completed row", async () => {
    const response = await POST(
      chatRequest({
        assistantId: "assistant-1",
        topicId: "topic-1",
        providerConfigId: "cfg-1",
        modelId: "model-1",
        message: {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      }),
    );

    const body = await response.text();

    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: "topic-1",
        outcome: "failed",
        errorMessage: PROVIDER_MESSAGE,
      }),
      ACTOR,
    );
    // The client gets our copy; the SDK's own fallback is never what a user
    // sees, or the provider detail would be invisible until a reload.
    expect(body).toContain(PROVIDER_MESSAGE);
    expect(body).not.toContain("An error occurred.");
  });

  // The SDK default is two retries with a doubling backoff (2s then 4s), and
  // every 408/409/429/5xx is retryable by default — so a deterministic failure
  // used to stall ~6s before the user saw anything.
  it("retries once so the wait is a single 2s pause", async () => {
    const response = await POST(
      chatRequest({
        assistantId: "assistant-1",
        topicId: "topic-1",
        providerConfigId: "cfg-1",
        modelId: "model-1",
        message: {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      }),
    );
    await response.text();

    expect(streamTextOptions.current).toMatchObject({ maxRetries: 1 });
  });
});

const STREAM_USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** A model that streams a one-word answer and finishes cleanly. */
function okModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "ok" },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage: STREAM_USAGE,
        },
      ]),
    }),
  });
}

const LONG_TEXT = "a".repeat(4000);
const LONG_HISTORY = [
  { id: "old-1", role: "user", parts: [{ type: "text", text: LONG_TEXT }] },
  { id: "old-2", role: "assistant", parts: [{ type: "text", text: LONG_TEXT }] },
];

function sendTurn() {
  return POST(
    chatRequest({
      assistantId: "assistant-1",
      topicId: "topic-1",
      providerConfigId: "cfg-1",
      modelId: "model-1",
      message: {
        id: "message-1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      },
    }),
  );
}

describe("POST /api/chat history compression", () => {
  beforeEach(() => {
    resolveOwnedFileParts.mockResolvedValue([]);
    resolveAttachmentsForModel.mockImplementation(
      async (messages: unknown) => messages,
    );
    // ~4000 estimated tokens of history against a 1000-token window trips
    // the 80% threshold.
    resolveAvailableModels.mockResolvedValue([
      {
        configId: "cfg-1",
        modelId: "model-1",
        inputModalities: ["text"],
        reasoning: false,
        reasoningOptions: [],
        contextTokens: 1000,
      },
    ]);
    listTopicMessages.mockResolvedValue(LONG_HISTORY);
    createChatModelHandle.mockResolvedValue({
      model: okModel(),
      describeError: () => ({ kind: "key", key: "generic" }),
      apiFormat: "openai-compatible",
      providerConfigId: "cfg-1",
      filesApi: null,
    });
  });

  it("auto-compresses over the threshold: the summary rides the instructions and only post-boundary messages reach the model", async () => {
    compressTopicHistory.mockResolvedValue({
      summaryText: "early chat summary",
      summaryUpToMessageId: "old-2",
      summaryUpToGroupId: "old-2",
      compressedCount: 2,
    });

    const response = await sendTurn();
    await response.text();

    expect(compressTopicHistory).toHaveBeenCalledWith(
      { topicId: "topic-1", handle: expect.anything() },
      ACTOR,
    );
    const options = streamTextOptions.current as { instructions: string };
    expect(options.instructions).toContain("early chat summary");
    // The boundary covered every history row, so the model payload is the
    // new user message alone.
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "message-1", role: "user" })],
      expect.anything(),
    );
  });

  it("continues with the full uncompressed history when summary generation fails", async () => {
    compressTopicHistory.mockRejectedValue(new Error("provider down"));

    const response = await sendTurn();
    await response.text();

    const options = streamTextOptions.current as { instructions: string };
    expect(options.instructions).not.toContain("compressed");
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: "old-1" }),
        expect.objectContaining({ id: "old-2" }),
        expect.objectContaining({ id: "message-1" }),
      ],
      expect.anything(),
    );
  });

  it("reuses the persisted summary without re-compressing under the threshold", async () => {
    resolveAvailableModels.mockResolvedValue([
      {
        configId: "cfg-1",
        modelId: "model-1",
        inputModalities: ["text"],
        reasoning: false,
        reasoningOptions: [],
        contextTokens: 256000,
      },
    ]);
    getTopicSummaryState.mockResolvedValue({
      summaryText: "old summary",
      summaryUpToMessageId: "old-2",
      summaryUpToGroupId: "old-2",
    });

    const response = await sendTurn();
    await response.text();

    expect(compressTopicHistory).not.toHaveBeenCalled();
    const options = streamTextOptions.current as { instructions: string };
    expect(options.instructions).toContain("old summary");
    // Everything up to the boundary is summarized away; the model only gets
    // the new user message.
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "message-1", role: "user" })],
      expect.anything(),
    );
  });

  it("keeps the persisted summary when there is nothing new to fold in", async () => {
    // Tiny window: the threshold is exceeded, but the boundary already covers
    // every history row, so no compression request should be made.
    getTopicSummaryState.mockResolvedValue({
      summaryText: "old summary",
      summaryUpToMessageId: "old-2",
      summaryUpToGroupId: "old-2",
    });

    const response = await sendTurn();
    await response.text();

    expect(compressTopicHistory).not.toHaveBeenCalled();
    const options = streamTextOptions.current as { instructions: string };
    expect(options.instructions).toContain("old summary");
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "message-1", role: "user" })],
      expect.anything(),
    );
  });

  it("retains the persisted summary and post-boundary history when re-compression fails", async () => {
    getTopicSummaryState.mockResolvedValue({
      summaryText: "old summary",
      summaryUpToMessageId: "old-1",
      summaryUpToGroupId: "old-1",
    });
    compressTopicHistory.mockRejectedValue(new Error("provider down"));

    const response = await sendTurn();
    await response.text();

    expect(compressTopicHistory).toHaveBeenCalled();
    const options = streamTextOptions.current as { instructions: string };
    expect(options.instructions).toContain("old summary");
    // The persisted boundary still clips old-1; the failure must not revert to
    // the full history (which the summary already covers) nor drop the summary.
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: "old-2" }),
        expect.objectContaining({ id: "message-1" }),
      ],
      expect.anything(),
    );
  });
});
