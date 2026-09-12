import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireActor,
  resolveAvailableModels,
  resolveOwnedFileParts,
  createChatModelHandle,
  resolveAttachmentsForModel,
  appendUserMessage,
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
  appendAssistantMessage: vi.fn(),
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
  providerErrorText: vi.fn(() => "error"),
}));
vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
