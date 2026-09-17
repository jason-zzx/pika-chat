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
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/ai/model-resolution", () => ({ resolveAvailableModels }));
vi.mock("@/server/ai/chat-model", () => ({ createChatModelHandle }));
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
}));
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

function regenerateRequest(): Request {
  return new Request(
    "http://localhost/api/topics/topic-1/messages/m-1/regenerate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerConfigId: "cfg-1", modelId: "model-1" }),
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
