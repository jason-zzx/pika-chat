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
  resolveModelPreference,
  generateImageForEndpoint,
  uploadFile,
  deleteFile,
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
  resolveModelPreference: vi.fn(),
  generateImageForEndpoint: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
}));

// Controllable abort for the image-bypass stop test: the real registry's
// controller is internal, so the mock hands out a signal the test can abort.
const streamControl = vi.hoisted(() => ({
  controller: null as AbortController | null,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/ai/model-resolution", () => ({ resolveAvailableModels }));
vi.mock("@/server/files/file.service", () => ({
  resolveOwnedFileParts,
  uploadFile,
  deleteFile,
}));
vi.mock("@/server/ai/chat-model", () => ({ createChatModelHandle }));
vi.mock("@/server/ai/image/generate", () => ({ generateImageForEndpoint }));
vi.mock("@/server/ai/stream-registry", () => ({
  registerStream: vi.fn(() => {
    streamControl.controller = new AbortController();
    return streamControl.controller.signal;
  }),
  releaseStream: vi.fn(),
}));
vi.mock("@/server/ai/attachments", () => ({ resolveAttachmentsForModel }));
vi.mock("@/server/services/message.service", () => ({
  appendUserMessage,
  appendAssistantMessage,
  listTopicMessages,
  // Faithful stand-in: the image bypass derives the prompt from it.
  textFromMessage: (message: {
    parts: Array<{ type: string; text?: string }>;
  }) =>
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
}));
vi.mock("@/server/services/topic.service", () => ({
  createTopicForChat,
  findTopicContextForActor,
  touchTopicUpdatedAt,
}));
vi.mock("@/server/services/search-provider.service", () => ({
  resolveSearchProviderCredentials,
}));
vi.mock("@/server/services/model-preferences.service", () => ({
  resolveModelPreference,
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
vi.mock("@/server/ai/provider-error", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/ai/provider-error")>();
  return {
    ...actual,
    // Faithful passthrough so a test can assert the text the user actually
    // sees; describeProviderError stays real so AppError pass-through (code
    // + messageKey, e.g. a quota failure from uploadFile) is exercised.
    providerErrorText: vi.fn(
      (description: { kind: string; messageKey?: string; message?: string }) =>
        description.kind === "verbatim"
          ? description.message
          : description.messageKey,
    ),
  };
});
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
import { describeProviderError } from "@/server/ai/provider-error";

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
  streamTextOptions.current = undefined;
  streamControl.controller = null;
  requireActor.mockResolvedValue(ACTOR);
  resolveAvailableModels.mockResolvedValue([
    {
      configId: "cfg-1",
      modelId: "model-1",
      inputModalities: ["text"],
      outputModalities: ["text"],
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
  resolveModelPreference.mockResolvedValue(null);
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
        outputModalities: ["text"],
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

  it("auto-compresses with the compression model preference when set (threshold still uses the session model)", async () => {
    resolveModelPreference.mockResolvedValue({
      providerConfigId: "cfg-1",
      modelId: "model-1",
    });
    const sessionHandle = {
      model: okModel(),
      describeError: () => ({ kind: "key", key: "generic" }),
      apiFormat: "openai-compatible",
      providerConfigId: "cfg-1",
      filesApi: null,
    };
    const preferenceHandle = {
      model: {},
      describeError: () => ({ kind: "key", key: "generic" }),
      apiFormat: "openai-compatible",
      providerConfigId: "cfg-1",
      filesApi: null,
    };
    createChatModelHandle
      .mockResolvedValueOnce(sessionHandle)
      .mockResolvedValueOnce(preferenceHandle);
    compressTopicHistory.mockResolvedValue({
      summaryText: "early chat summary",
      summaryUpToMessageId: "old-2",
      summaryUpToGroupId: "old-2",
      compressedCount: 2,
    });

    const response = await sendTurn();
    await response.text();

    expect(resolveModelPreference).toHaveBeenCalledWith(ACTOR, "compression");
    expect(compressTopicHistory).toHaveBeenCalledWith(
      { topicId: "topic-1", handle: preferenceHandle },
      ACTOR,
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
        outputModalities: ["text"],
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

const IMAGE_MODEL = {
  configId: "cfg-1",
  modelId: "gpt-image-1",
  inputModalities: ["text"],
  outputModalities: ["image", "text"],
  reasoning: false,
  reasoningOptions: [],
};

function imageHandle(overrides: Record<string, unknown> = {}) {
  return {
    model: {},
    describeError: () => ({ kind: "key", key: "generic" }),
    apiFormat: "openai-compatible",
    providerConfigId: "cfg-1",
    filesApi: null,
    endpoint: {
      apiFormat: "openai-compatible",
      name: "test",
      baseUrl: "https://api.test/v1",
      apiKey: "k",
    },
    ...overrides,
  };
}

function imageRequest(body: Record<string, unknown> = {}): Request {
  return chatRequest({
    assistantId: "assistant-1",
    topicId: "topic-1",
    providerConfigId: "cfg-1",
    modelId: "gpt-image-1",
    message: {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "draw a cat" }],
    },
    ...body,
  });
}

describe("POST /api/chat image generation bypass", () => {
  beforeEach(() => {
    resolveAvailableModels.mockResolvedValue([IMAGE_MODEL]);
    createChatModelHandle.mockResolvedValue(imageHandle());
    generateImageForEndpoint.mockResolvedValue({
      images: [{ bytes: Buffer.from("png-bytes"), mediaType: "image/png" }],
    });
    uploadFile.mockImplementation(
      async (input: { mediaType: string; data: Buffer }) => ({
        id: "img-1",
        url: "/api/files/img-1",
        filename: "generated.png",
        mediaType: input.mediaType,
        sizeBytes: input.data.byteLength,
        extraction: { status: "none", truncated: false },
      }),
    );
  });

  it("generates, stores the images as files, and streams one complete assistant message", async () => {
    generateImageForEndpoint.mockResolvedValue({
      images: [
        { bytes: Buffer.from("a"), mediaType: "image/png" },
        { bytes: Buffer.from("bb"), mediaType: "image/jpeg" },
      ],
      text: "here you go",
    });
    uploadFile
      .mockImplementationOnce(async () => ({
        id: "img-1",
        url: "/api/files/img-1",
        filename: "generated.png",
        mediaType: "image/png",
        sizeBytes: 1,
        extraction: { status: "none", truncated: false },
      }))
      .mockImplementationOnce(async () => ({
        id: "img-2",
        url: "/api/files/img-2",
        filename: "generated.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 2,
        extraction: { status: "none", truncated: false },
      }));

    const response = await POST(
      imageRequest({ image: { size: "1024x1024", n: 2, quality: "high" } }),
    );
    const body = await response.text();

    // The bypass never touches the text pipeline.
    expect(streamTextOptions.current).toBeUndefined();
    expect(resolveAttachmentsForModel).not.toHaveBeenCalled();
    expect(compressTopicHistory).not.toHaveBeenCalled();

    expect(generateImageForEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://api.test/v1" }),
      "gpt-image-1",
      { prompt: "draw a cat", n: 2, size: "1024x1024", quality: "high" },
      expect.any(AbortSignal),
    );
    expect(appendUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: "topic-1" }),
      ACTOR,
    );
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: "topic-1",
        outcome: "completed",
        providerConfigId: "cfg-1",
        modelId: "gpt-image-1",
        message: expect.objectContaining({
          role: "assistant",
          parts: [
            {
              type: "file",
              url: "/api/files/img-1",
              mediaType: "image/png",
              filename: "generated.png",
              sizeBytes: 1,
            },
            {
              type: "file",
              url: "/api/files/img-2",
              mediaType: "image/jpeg",
              filename: "generated.jpg",
              sizeBytes: 2,
            },
            { type: "text", text: "here you go" },
          ],
        }),
      }),
      ACTOR,
    );
    // The client sees the same file parts and the topic data chunk.
    expect(body).toContain("/api/files/img-1");
    expect(body).toContain("/api/files/img-2");
    expect(body).toContain("here you go");
    expect(body).toContain("data-topic");
  });

  it("creates the topic through the same draft path when no topicId is given", async () => {
    createTopicForChat.mockResolvedValue({ id: "topic-new" });

    const response = await POST(
      chatRequest({
        assistantId: "assistant-1",
        providerConfigId: "cfg-1",
        modelId: "gpt-image-1",
        message: {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "draw a cat" }],
        },
      }),
    );
    await response.text();

    expect(createTopicForChat).toHaveBeenCalledWith(
      { assistantId: "assistant-1" },
      ACTOR,
      expect.anything(),
    );
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: "topic-new" }),
      ACTOR,
    );
  });

  it("rejects an image model on the claude format before any persistence", async () => {
    createChatModelHandle.mockResolvedValue(
      imageHandle({
        apiFormat: "claude",
        endpoint: {
          apiFormat: "claude",
          name: "test",
          baseUrl: "https://api.test/v1",
          apiKey: "k",
        },
      }),
    );

    const response = await POST(imageRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "model.imageUnsupported" },
    });
    expect(appendUserMessage).not.toHaveBeenCalled();
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
  });

  it("rejects attachments on an image model without creating a draft topic", async () => {
    const response = await POST(
      chatRequest({
        assistantId: "assistant-1",
        providerConfigId: "cfg-1",
        modelId: "gpt-image-1",
        message: { id: "message-1", role: "user", parts: [FILE_PART] },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "image.attachmentUnsupported" },
    });
    expect(createTopicForChat).not.toHaveBeenCalled();
    expect(appendUserMessage).not.toHaveBeenCalled();
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
  });

  it("rejects a size outside the model's tiers, naming the parameter", async () => {
    const response = await POST(imageRequest({ image: { size: "999x999" } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        messageKey: "image.invalidParams",
        params: { param: "size" },
      },
    });
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
  });

  it("rejects n above the model's maximum", async () => {
    // dall-e-3 caps at 1; gpt-image's nMax 10 coincides with the request
    // schema's own ceiling, so the capability gate is only reachable here.
    resolveAvailableModels.mockResolvedValue([
      { ...IMAGE_MODEL, modelId: "dall-e-3" },
    ]);

    const response = await POST(
      imageRequest({ modelId: "dall-e-3", image: { n: 2 } }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "image.invalidParams", params: { param: "n" } },
    });
  });

  it("rejects a quality the model does not offer", async () => {
    const response = await POST(
      imageRequest({ image: { quality: "ultra" } }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        messageKey: "image.invalidParams",
        params: { param: "quality" },
      },
    });
  });

  it("rejects an imageSize on a model without image size tiers", async () => {
    const response = await POST(
      imageRequest({ image: { imageSize: "2K" } }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        messageKey: "image.invalidParams",
        params: { param: "imageSize" },
      },
    });
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
  });

  it("forwards a Gemini imageSize tier to the provider call on the google format", async () => {
    resolveAvailableModels.mockResolvedValue([
      { ...IMAGE_MODEL, modelId: "gemini-3-pro-image" },
    ]);
    createChatModelHandle.mockResolvedValue(
      imageHandle({
        apiFormat: "google",
        endpoint: {
          apiFormat: "google",
          name: "test",
          baseUrl: "https://api.test/v1beta",
          apiKey: "k",
        },
      }),
    );

    const response = await POST(
      imageRequest({
        modelId: "gemini-3-pro-image",
        image: { size: "16:9", imageSize: "2K" },
      }),
    );
    await response.text();

    expect(generateImageForEndpoint).toHaveBeenCalledWith(
      expect.anything(),
      "gemini-3-pro-image",
      expect.objectContaining({ size: "16:9", imageSize: "2K", n: 1 }),
      expect.any(AbortSignal),
    );
  });

  it("strips imageSize when a gemini-capable model is served over openai-compatible", async () => {
    // The capability table validates the tier (gemini-3-pro-image offers
    // 2K), but the OpenAI image endpoint has no resolution-tier parameter —
    // a gateway serving the model over this format would silently ignore it.
    resolveAvailableModels.mockResolvedValue([
      { ...IMAGE_MODEL, modelId: "gemini-3-pro-image" },
    ]);

    const response = await POST(
      imageRequest({
        modelId: "gemini-3-pro-image",
        image: { size: "16:9", imageSize: "2K" },
      }),
    );
    await response.text();

    expect(generateImageForEndpoint).toHaveBeenCalledWith(
      expect.anything(),
      "gemini-3-pro-image",
      { prompt: "draw a cat", n: 1, size: "16:9" },
      expect.any(AbortSignal),
    );
  });

  it("rejects a Gemini imageSize tier the model does not offer", async () => {
    // gemini-2.5-flash-image is 1K-only; a 2K request is a 400.
    resolveAvailableModels.mockResolvedValue([
      { ...IMAGE_MODEL, modelId: "gemini-2.5-flash-image" },
    ]);

    const response = await POST(
      imageRequest({
        modelId: "gemini-2.5-flash-image",
        image: { size: "16:9", imageSize: "2K" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        messageKey: "image.invalidParams",
        params: { param: "imageSize" },
      },
    });
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
  });

  it("rejects a custom size below the model's pixel floor", async () => {
    // seedream-4.5 requires at least 3,686,400 pixels; 1024x1024 is under.
    resolveAvailableModels.mockResolvedValue([
      { ...IMAGE_MODEL, modelId: "doubao-seedream-4-5-251128" },
    ]);

    const response = await POST(
      imageRequest({
        modelId: "doubao-seedream-4-5-251128",
        image: { size: "1024x1024" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "image.invalidParams", params: { param: "size" } },
    });
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
    expect(appendUserMessage).not.toHaveBeenCalled();
  });

  it("passes a freeform custom size through for freeform models", async () => {
    resolveAvailableModels.mockResolvedValue([
      { ...IMAGE_MODEL, modelId: "seedream-4" },
    ]);

    const response = await POST(
      chatRequest({
        assistantId: "assistant-1",
        topicId: "topic-1",
        providerConfigId: "cfg-1",
        modelId: "seedream-4",
        image: { size: "1234x567" },
        message: {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "draw a cat" }],
        },
      }),
    );
    await response.text();

    expect(generateImageForEndpoint).toHaveBeenCalledWith(
      expect.anything(),
      "seedream-4",
      expect.objectContaining({ size: "1234x567", n: 1 }),
      expect.any(AbortSignal),
    );
  });

  it("rejects a custom size violating a constrained freeform model's limits", async () => {
    resolveAvailableModels.mockResolvedValue([
      { ...IMAGE_MODEL, modelId: "gpt-image-2" },
    ]);

    // 1537 is not divisible by 16.
    const response = await POST(
      imageRequest({ modelId: "gpt-image-2", image: { size: "1537x864" } }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "image.invalidParams", params: { param: "size" } },
    });
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
    expect(appendUserMessage).not.toHaveBeenCalled();
  });

  it("accepts a constraint-satisfying custom size for gpt-image-2", async () => {
    resolveAvailableModels.mockResolvedValue([
      { ...IMAGE_MODEL, modelId: "gpt-image-2" },
    ]);

    const response = await POST(
      imageRequest({ modelId: "gpt-image-2", image: { size: "1536x864" } }),
    );
    await response.text();

    expect(generateImageForEndpoint).toHaveBeenCalledWith(
      expect.anything(),
      "gpt-image-2",
      expect.objectContaining({ size: "1536x864", n: 1 }),
      expect.any(AbortSignal),
    );
  });

  it("cleans up already-stored images when a stop lands during the upload loop", async () => {
    generateImageForEndpoint.mockResolvedValue({
      images: [
        { bytes: Buffer.from("a"), mediaType: "image/png" },
        { bytes: Buffer.from("bb"), mediaType: "image/png" },
      ],
    });
    uploadFile.mockImplementationOnce(async () => {
      // The user hits stop while the first image is being stored.
      streamControl.controller?.abort();
      return {
        id: "img-1",
        url: "/api/files/img-1",
        filename: "generated.png",
        mediaType: "image/png",
        sizeBytes: 1,
        extraction: { status: "none", truncated: false },
      };
    });

    const response = await POST(imageRequest());
    await response.text();

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("img-1", ACTOR);
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "stopped",
        errorMessage: null,
        message: expect.objectContaining({ parts: [] }),
      }),
      ACTOR,
    );
  });

  it("cleans up already-stored images when a later one fails", async () => {
    generateImageForEndpoint.mockResolvedValue({
      images: [
        { bytes: Buffer.from("a"), mediaType: "image/png" },
        { bytes: Buffer.from("bb"), mediaType: "image/png" },
      ],
    });
    uploadFile
      .mockImplementationOnce(async () => ({
        id: "img-1",
        url: "/api/files/img-1",
        filename: "generated.png",
        mediaType: "image/png",
        sizeBytes: 1,
        extraction: { status: "none", truncated: false },
      }))
      .mockRejectedValueOnce(
        new AppError("QUOTA_EXCEEDED", 413, "file.quotaExceeded", {
          used: "4.9 GiB",
          quota: "5 GiB",
        }),
      );

    const response = await POST(imageRequest());
    await response.text();

    // The first image must not be left behind as an unreferenced row
    // counting against the quota until the orphan sweep.
    expect(deleteFile).toHaveBeenCalledWith("img-1", ACTOR);
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        message: expect.objectContaining({ parts: [] }),
      }),
      ACTOR,
    );
  });

  it("persists the quota error text when storing the generated image hits the quota", async () => {
    createChatModelHandle.mockResolvedValue(
      imageHandle({
        // The real handle's describeProviderError: our own AppError passes
        // through with its catalog key instead of "provider.unreachable".
        describeError: (error: unknown) =>
          describeProviderError(error, {
            apiKey: "k",
            baseUrl: "https://api.test/v1",
          }),
      }),
    );
    uploadFile.mockRejectedValue(
      new AppError("QUOTA_EXCEEDED", 413, "file.quotaExceeded", {
        used: "4.9 GiB",
        quota: "5 GiB",
      }),
    );

    const response = await POST(imageRequest());
    const body = await response.text();

    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        errorMessage: "file.quotaExceeded",
        message: expect.objectContaining({ parts: [] }),
      }),
      ACTOR,
    );
    expect(body).toContain("file.quotaExceeded");
  });

  it("persists a failed outcome with the error text when generation fails", async () => {
    createChatModelHandle.mockResolvedValue(
      imageHandle({
        describeError: () => ({ kind: "verbatim", message: "provider boom" }),
      }),
    );
    generateImageForEndpoint.mockRejectedValue(new Error("provider boom"));

    const response = await POST(imageRequest());
    const body = await response.text();

    expect(body).toContain("provider boom");
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        errorMessage: "provider boom",
        message: expect.objectContaining({ parts: [] }),
      }),
      ACTOR,
    );
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("persists a stopped outcome without partial images when the turn is aborted", async () => {
    generateImageForEndpoint.mockImplementation(async () => {
      streamControl.controller?.abort();
      throw new Error("The operation was aborted");
    });

    const response = await POST(imageRequest());
    await response.text();

    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "stopped",
        errorMessage: null,
        message: expect.objectContaining({ parts: [] }),
      }),
      ACTOR,
    );
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
