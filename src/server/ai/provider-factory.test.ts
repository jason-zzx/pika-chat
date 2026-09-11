import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLanguageModel } from "./provider-factory";

type SdkOptions = {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  includeUsage?: boolean;
  fetch?: unknown;
};

/**
 * The anthropic and google providers are callable rather than exposing
 * `.chatModel`, so each factory returns the model factory itself and the
 * recorded options come back on the produced model.
 */
const mocks = vi.hoisted(() => {
  const createOpenAICompatible = vi.fn((options?: SdkOptions) => ({
    chatModel: vi.fn((modelId?: string) => ({
      format: "openai-compatible",
      modelId,
      options,
    })),
  }));
  const createAnthropic = vi.fn((options?: SdkOptions) =>
    vi.fn((modelId?: string) => ({ format: "claude", modelId, options })),
  );
  const createGoogle = vi.fn((options?: SdkOptions) =>
    vi.fn((modelId?: string) => ({ format: "google", modelId, options })),
  );
  return { createOpenAICompatible, createAnthropic, createGoogle };
});

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));
vi.mock("@ai-sdk/google", () => ({ createGoogle: mocks.createGoogle }));

const OPENAI_ENDPOINT = {
  apiFormat: "openai-compatible",
  name: "my-relay",
  baseUrl: "https://relay.example.com/v1",
  apiKey: "sk-secret",
} as const;

const CLAUDE_ENDPOINT = {
  apiFormat: "claude",
  name: "anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "sk-ant-secret",
} as const;

const GOOGLE_ENDPOINT = {
  apiFormat: "google",
  name: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  apiKey: "goog-secret",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createLanguageModel", () => {
  describe("openai-compatible", () => {
    it("builds a chat model with usage reporting", () => {
      const model = createLanguageModel(OPENAI_ENDPOINT, "gpt-4o");

      expect(mocks.createOpenAICompatible).toHaveBeenCalledWith({
        name: "my-relay",
        baseURL: "https://relay.example.com/v1",
        apiKey: "sk-secret",
        includeUsage: true,
      });
      expect(model).toMatchObject({
        format: "openai-compatible",
        modelId: "gpt-4o",
      });
    });

    it("passes no apiKey for keyless local endpoints", () => {
      createLanguageModel({ ...OPENAI_ENDPOINT, apiKey: "" }, "llama3");

      expect(
        mocks.createOpenAICompatible.mock.calls[0]?.[0]?.apiKey,
      ).toBeUndefined();
    });
  });

  describe("claude", () => {
    it("builds a messages model through the callable provider", () => {
      const model = createLanguageModel(CLAUDE_ENDPOINT, "claude-sonnet-4-5");

      expect(mocks.createAnthropic).toHaveBeenCalledWith({
        baseURL: "https://api.anthropic.com/v1",
        apiKey: "sk-ant-secret",
      });
      expect(model).toMatchObject({
        format: "claude",
        modelId: "claude-sonnet-4-5",
      });
      expect(mocks.createOpenAICompatible).not.toHaveBeenCalled();
    });
  });

  describe("google", () => {
    it("builds a generateContent model through the callable provider", () => {
      const model = createLanguageModel(GOOGLE_ENDPOINT, "gemini-2.5-flash");

      expect(mocks.createGoogle).toHaveBeenCalledWith({
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        apiKey: "goog-secret",
      });
      expect(model).toMatchObject({
        format: "google",
        modelId: "gemini-2.5-flash",
      });
      expect(mocks.createOpenAICompatible).not.toHaveBeenCalled();
    });
  });

  describe("builtin search wiring", () => {
    it("attaches the fetch wrapper for openai-compatible", () => {
      createLanguageModel(OPENAI_ENDPOINT, "gpt-4o", { builtinSearch: true });

      expect(
        mocks.createOpenAICompatible.mock.calls[0]?.[0]?.fetch,
      ).toBeTypeOf("function");
    });

    it("attaches the fetch wrapper for claude", () => {
      createLanguageModel(CLAUDE_ENDPOINT, "claude-sonnet-4-5", {
        builtinSearch: true,
      });

      expect(mocks.createAnthropic.mock.calls[0]?.[0]?.fetch).toBeTypeOf(
        "function",
      );
    });

    it("attaches the fetch wrapper for google", () => {
      createLanguageModel(GOOGLE_ENDPOINT, "gemini-2.5-flash", {
        builtinSearch: true,
      });

      expect(mocks.createGoogle.mock.calls[0]?.[0]?.fetch).toBeTypeOf(
        "function",
      );
    });

    it.each([undefined, { builtinSearch: false }, { builtinSearch: undefined }])(
      "attaches no fetch wrapper otherwise (options=%j)",
      (options) => {
        createLanguageModel(OPENAI_ENDPOINT, "gpt-4o", options);

        expect(
          mocks.createOpenAICompatible.mock.calls[0]?.[0]?.fetch,
        ).toBeUndefined();
      },
    );
  });
});
