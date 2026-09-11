import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";

import { createChatModelHandle } from "./chat-model";

const { createOpenAICompatible, resolveAvailableModels } = vi.hoisted(() => ({
  createOpenAICompatible: vi.fn((options?: { fetch?: unknown }) => ({
    chatModel: vi.fn(() => ({})),
    capturedOptions: options,
  })),
  resolveAvailableModels: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible }));

vi.mock("@/server/ai/model-resolution", () => ({ resolveAvailableModels }));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: "cfg-1",
              name: "openai",
              baseUrl: "https://api.example.com/v1",
              apiFormat: "openai-compatible",
              encryptedApiKey: "encrypted",
            },
          ],
        }),
      }),
    }),
  }),
}));

vi.mock("@/server/crypto", () => ({
  decryptSecret: () => "sk-plaintext",
}));

const actor: Actor = { userId: "user-1", role: "user" };
const pair = { providerConfigId: "cfg-1", modelId: "model-1" };

describe("createChatModelHandle builtin search", () => {
  beforeEach(() => {
    createOpenAICompatible.mockClear();
    resolveAvailableModels.mockReset();
    resolveAvailableModels.mockResolvedValue([
      { configId: pair.providerConfigId, modelId: pair.modelId },
    ]);
  });

  it("attaches the fetch wrapper only in builtin search mode", async () => {
    await createChatModelHandle(pair, actor, { builtinSearch: true });

    const options = createOpenAICompatible.mock.calls[0]?.[0];
    expect(options?.fetch).toBeTypeOf("function");
  });

  it.each([undefined, { builtinSearch: false }, { builtinSearch: undefined }])(
    "attaches no fetch wrapper otherwise (options=%j)",
    async (options) => {
      await createChatModelHandle(pair, actor, options);

      const passed = createOpenAICompatible.mock.calls[0]?.[0];
      expect(passed?.fetch).toBeUndefined();
    },
  );
});
