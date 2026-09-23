import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { APICallError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireActor,
  resolveAvailableModels,
  createChatModelHandle,
  resolveAttachmentsForModel,
  resolveRegenerateTarget,
  appendAssistantMessage,
  findTopicContextForActor,
  touchTopicUpdatedAt,
  resolveSearchProviderCredentials,
  getTopicSummaryState,
  generateImageForEndpoint,
  uploadFile,
  deleteFile,
} = vi.hoisted(() => ({
  requireActor: vi.fn(),
  resolveAvailableModels: vi.fn(),
  createChatModelHandle: vi.fn(),
  resolveAttachmentsForModel: vi.fn(),
  resolveRegenerateTarget: vi.fn(),
  appendAssistantMessage: vi.fn(),
  findTopicContextForActor: vi.fn(),
  touchTopicUpdatedAt: vi.fn(),
  resolveSearchProviderCredentials: vi.fn(),
  getTopicSummaryState: vi.fn(),
  generateImageForEndpoint: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/ai/model-resolution", () => ({ resolveAvailableModels }));
vi.mock("@/server/ai/chat-model", () => ({ createChatModelHandle }));
vi.mock("@/server/ai/image/generate", () => ({ generateImageForEndpoint }));
vi.mock("@/server/ai/attachments", () => ({ resolveAttachmentsForModel }));
vi.mock("@/server/ai/model-messages", () => ({
  replayModelMessages: vi.fn(async (messages: unknown) => messages),
}));
vi.mock("@/server/ai/output-budget", () => ({
  resolvedMaxOutputTokens: vi.fn(() => 1000),
}));
vi.mock("@/server/ai/reasoning-effort", () => ({
  resolvedReasoningEffort: vi.fn(() => undefined),
}));
vi.mock("@/server/ai/provider-error", () => ({
  // Faithful passthrough so the test can assert the text the user sees.
  providerErrorText: vi.fn(
    (description: { kind: string; messageKey?: string; message?: string }) =>
      description.kind === "verbatim"
        ? description.message
        : description.messageKey,
  ),
}));
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
vi.mock("@/server/services/message.service", () => ({
  appendAssistantMessage,
  resolveRegenerateTarget,
  // Faithful stand-in: the image bypass derives the prompt from it.
  textFromMessage: (message: {
    parts: Array<{ type: string; text?: string }>;
  }) =>
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
}));
vi.mock("@/server/files/file.service", () => ({ uploadFile, deleteFile }));
vi.mock("@/server/services/topic.service", () => ({
  findTopicContextForActor,
  touchTopicUpdatedAt,
}));
vi.mock("@/server/services/search-provider.service", () => ({
  resolveSearchProviderCredentials,
}));
// Keep the real boundary-clip logic; stub only the database read.
vi.mock("@/server/services/compression.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/services/compression.service")>();
  return { ...actual, getTopicSummaryState };
});
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

import { POST } from "./route";

const ACTOR = { userId: "user-1", role: "user" as const };
const PROVIDER_MESSAGE = "insufficient_quota: you exceeded your current quota";

const CONTEXT = { params: Promise.resolve({ id: "topic-1", messageId: "m-1" }) };

function regenerateRequest(body: Record<string, unknown> = {}): Request {
  return new Request(
    "http://localhost/api/topics/topic-1/messages/m-1/regenerate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerConfigId: "cfg-1",
        modelId: "model-1",
        ...body,
      }),
    },
  );
}

/** A model whose provider call fails after the stream has opened. */
function failingModel(error: unknown) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.error(error);
        },
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(ACTOR);
  getTopicSummaryState.mockResolvedValue(null);
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
  resolveAttachmentsForModel.mockResolvedValue([]);
  resolveSearchProviderCredentials.mockResolvedValue([]);
  findTopicContextForActor.mockResolvedValue({
    assistant: { systemPrompt: null },
  });
  resolveRegenerateTarget.mockResolvedValue({
    targetGroupId: "group-1",
    history: [],
  });
  appendAssistantMessage.mockResolvedValue(undefined);
  touchTopicUpdatedAt.mockResolvedValue(undefined);
  createChatModelHandle.mockResolvedValue({
    model: failingModel(
      new APICallError({
        message: "Too Many Requests",
        url: "https://provider.test/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseBody: JSON.stringify({
          error: {
            message: "you exceeded your current quota",
            code: "insufficient_quota",
          },
        }),
      }),
    ),
    describeError: () => ({
      code: "RATE_LIMITED",
      kind: "verbatim",
      message: PROVIDER_MESSAGE,
    }),
    apiFormat: "openai-compatible",
    providerConfigId: "cfg-1",
    filesApi: null,
  });
});

// Regression: this route shared the send path's bug — a fatal stream error
// arrives at onEnd as `{ status: "unknown" }`, so keying on
// `outcome.status === "failed"` persisted the new version as `completed` with
// no error message and no text. The regenerated bubble then rendered blank and
// the reason was unrecoverable on reload.
describe("POST regenerate provider failure", () => {
  it("persists the failed version with the provider error", async () => {
    const response = await POST(regenerateRequest(), CONTEXT);
    const body = await response.text();

    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: "topic-1",
        outcome: "failed",
        errorMessage: PROVIDER_MESSAGE,
        groupId: "group-1",
      }),
      ACTOR,
    );
    expect(body).toContain(PROVIDER_MESSAGE);
    expect(body).not.toContain("An error occurred.");
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

// AC1b: regenerating inside a compressed topic must see the same trimmed
// context the chat route would — summary in the instructions, only
// post-boundary messages in the payload — without triggering compression.
describe("POST regenerate with a compressed topic", () => {
  const HISTORY = [
    { id: "h-1", role: "user", parts: [{ type: "text", text: "old turn" }] },
    {
      id: "h-2",
      role: "assistant",
      parts: [{ type: "text", text: "old answer" }],
    },
    { id: "h-3", role: "user", parts: [{ type: "text", text: "new turn" }] },
  ];

  beforeEach(() => {
    resolveAttachmentsForModel.mockImplementation(
      async (messages: unknown) => messages,
    );
    resolveRegenerateTarget.mockResolvedValue({
      targetGroupId: "group-1",
      history: HISTORY,
    });
    createChatModelHandle.mockResolvedValue({
      model: okModel(),
      describeError: () => ({ kind: "key", key: "generic" }),
      apiFormat: "openai-compatible",
      providerConfigId: "cfg-1",
      filesApi: null,
    });
  });

  it("carries the persisted summary in the instructions and only sends post-boundary messages", async () => {
    getTopicSummaryState.mockResolvedValue({
      summaryText: "early chat summary",
      summaryUpToMessageId: "h-1",
      summaryUpToGroupId: "h-1",
    });

    const response = await POST(regenerateRequest(), CONTEXT);
    await response.text();

    const options = streamTextOptions.current as { instructions: string };
    expect(options.instructions).toContain("early chat summary");
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: "h-2" }),
        expect.objectContaining({ id: "h-3" }),
      ],
      expect.anything(),
    );
  });

  it("clips by boundary group after the boundary group's selected version switched", async () => {
    getTopicSummaryState.mockResolvedValue({
      summaryText: "early chat summary",
      summaryUpToMessageId: "h-1",
      summaryUpToGroupId: "group-h1",
    });
    // The persisted boundary row h-1 is no longer the selected one; its group
    // now selects h-1b, so id-only matching would revert to the full history.
    resolveRegenerateTarget.mockResolvedValue({
      targetGroupId: "group-1",
      history: [
        {
          id: "h-1b",
          role: "assistant",
          parts: [{ type: "text", text: "old answer v2" }],
          metadata: { groupId: "group-h1" },
        },
        { id: "h-3", role: "user", parts: [{ type: "text", text: "new turn" }] },
      ],
    });

    const response = await POST(regenerateRequest(), CONTEXT);
    await response.text();

    const options = streamTextOptions.current as { instructions: string };
    expect(options.instructions).toContain("early chat summary");
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "h-3" })],
      expect.anything(),
    );
  });

  it("keeps the full history and no summary when the topic was never compressed", async () => {
    const response = await POST(regenerateRequest(), CONTEXT);
    await response.text();

    const options = streamTextOptions.current as { instructions: string };
    expect(options.instructions).not.toContain(
      "Summary of the earlier conversation",
    );
    expect(resolveAttachmentsForModel).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: "h-1" }),
        expect.objectContaining({ id: "h-2" }),
        expect.objectContaining({ id: "h-3" }),
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
      baseUrl: "https://api.test/v1",
      apiKey: "test-key",
    },
    ...overrides,
  };
}

// The prompt is the last user message of the target history; the assistant
// answer being regenerated carries the previously generated image.
const IMAGE_HISTORY = [
  { id: "u-1", role: "user", parts: [{ type: "text", text: "draw a cat" }] },
  {
    id: "a-1",
    role: "assistant",
    parts: [
      { type: "file", url: "/api/files/old-1", mediaType: "image/png" },
    ],
  },
];

describe("POST regenerate image generation bypass", () => {
  beforeEach(() => {
    resolveAvailableModels.mockResolvedValue([IMAGE_MODEL]);
    createChatModelHandle.mockResolvedValue(imageHandle());
    resolveRegenerateTarget.mockResolvedValue({
      targetGroupId: "group-1",
      history: IMAGE_HISTORY,
    });
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

  it("generates a new version into the target group without touching the text pipeline", async () => {
    const response = await POST(
      regenerateRequest({ modelId: "gpt-image-1", image: { size: "1024x1024" } }),
      CONTEXT,
    );
    const body = await response.text();

    // None of the streaming-path machinery runs.
    expect(resolveAttachmentsForModel).not.toHaveBeenCalled();
    expect(getTopicSummaryState).not.toHaveBeenCalled();

    // Prompt comes from the last user message of the target history.
    expect(generateImageForEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://api.test/v1" }),
      "gpt-image-1",
      { prompt: "draw a cat", n: 1, size: "1024x1024" },
      expect.any(AbortSignal),
    );

    // The new version joins the target group.
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: "topic-1",
        outcome: "completed",
        groupId: "group-1",
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
              sizeBytes: 9,
            },
          ],
        }),
      }),
      ACTOR,
    );

    // Regenerate framing: stream id in the header, no data-topic chunk.
    expect(response.headers.get("x-pika-stream-id")).toBeTruthy();
    expect(body).not.toContain("data-topic");
  });

  it("rejects an image model on the claude format before any persistence", async () => {
    createChatModelHandle.mockResolvedValue(
      imageHandle({
        apiFormat: "claude",
        endpoint: {
          apiFormat: "claude",
          baseUrl: "https://api.test/v1",
          apiKey: "test-key",
        },
      }),
    );

    const response = await POST(
      regenerateRequest({ modelId: "gpt-image-1" }),
      CONTEXT,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "model.imageUnsupported" },
    });
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
    expect(appendAssistantMessage).not.toHaveBeenCalled();
  });

  it("rejects a size outside the model's tiers, naming the parameter", async () => {
    const response = await POST(
      regenerateRequest({ modelId: "gpt-image-1", image: { size: "999x999" } }),
      CONTEXT,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "image.invalidParams", params: { param: "size" } },
    });
    expect(generateImageForEndpoint).not.toHaveBeenCalled();
    expect(appendAssistantMessage).not.toHaveBeenCalled();
  });

  it("persists a failed version with the error text when generation fails", async () => {
    createChatModelHandle.mockResolvedValue(
      imageHandle({
        describeError: () => ({ kind: "verbatim", message: "provider boom" }),
      }),
    );
    generateImageForEndpoint.mockRejectedValue(new Error("provider boom"));

    const response = await POST(
      regenerateRequest({ modelId: "gpt-image-1" }),
      CONTEXT,
    );
    const body = await response.text();

    expect(body).toContain("provider boom");
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: "topic-1",
        outcome: "failed",
        errorMessage: "provider boom",
        groupId: "group-1",
        message: expect.objectContaining({ role: "assistant", parts: [] }),
      }),
      ACTOR,
    );
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
