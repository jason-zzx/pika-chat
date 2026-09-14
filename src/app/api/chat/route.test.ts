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
vi.mock("@/server/ai/search/tool", () => ({
  buildSearchTools: vi.fn(),
  toolTurnStepSettings: vi.fn(() => ({})),
  withCitationDirective: vi.fn((value: string | undefined) => value),
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
