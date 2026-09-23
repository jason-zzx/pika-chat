import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";

import {
  fallbackTitleFromMessage,
  sanitizeGeneratedTitle,
  TITLE_MAX_LENGTH,
  titleTopicFromFirstMessage,
} from "./title.service";

const {
  createChatModelHandle,
  findTopicForActor,
  generateText,
  listTopicMessages,
  resolveAvailableModels,
  resolveModelPreference,
} = vi.hoisted(() => ({
  createChatModelHandle: vi.fn(),
  findTopicForActor: vi.fn(),
  generateText: vi.fn(),
  listTopicMessages: vi.fn(),
  resolveAvailableModels: vi.fn(),
  resolveModelPreference: vi.fn(),
}));

vi.mock("@/server/ai/chat-model", () => ({
  createChatModelHandle,
}));

vi.mock("@/server/ai/model-resolution", () => ({
  resolveAvailableModels,
}));

vi.mock("@/server/services/model-preferences.service", () => ({
  resolveModelPreference,
}));

vi.mock("@/server/services/message.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/services/message.service")>();
  return { ...actual, listTopicMessages };
});

vi.mock("@/server/services/topic.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/services/topic.service")>();
  return { ...actual, findTopicForActor };
});

vi.mock("ai", () => ({
  generateText,
}));

const actor: Actor = { userId: "user-1", role: "user" };

describe("sanitizeGeneratedTitle", () => {
  it("trims, strips quotes, and collapses whitespace", () => {
    expect(sanitizeGeneratedTitle('  "Hello\nworld"  ')).toBe("Hello world");
  });

  it("treats empty and over-long output as failure", () => {
    expect(sanitizeGeneratedTitle("   ")).toBeNull();
    expect(sanitizeGeneratedTitle("x".repeat(201))).toBeNull();
  });

  it("clamps a long but acceptable title", () => {
    const title = sanitizeGeneratedTitle("n".repeat(80));
    expect(title).toHaveLength(TITLE_MAX_LENGTH);
  });
});

describe("fallbackTitleFromMessage", () => {
  it("truncates the first user message", () => {
    const text = "a".repeat(TITLE_MAX_LENGTH + 10);
    const title = fallbackTitleFromMessage(text, "New topic");
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBe(TITLE_MAX_LENGTH + 1);
  });

  it("returns the provided default title for empty text", () => {
    expect(fallbackTitleFromMessage("   ", "New topic")).toBe("New topic");
  });
});

describe("titleTopicFromFirstMessage", () => {
  beforeEach(() => {
    findTopicForActor.mockReset();
    generateText.mockReset();
    createChatModelHandle.mockReset();
    listTopicMessages.mockReset();
    resolveAvailableModels.mockReset();
    resolveAvailableModels.mockResolvedValue([]);
    resolveModelPreference.mockReset();
    resolveModelPreference.mockResolvedValue(null);
  });

  it("returns an already-named topic without calling the model", async () => {
    const named = {
      id: "topic-1",
      title: "Lunch ideas",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    findTopicForActor.mockResolvedValue(named);

    const result = await titleTopicFromFirstMessage(
      {
        topicId: named.id,
        providerConfigId: "cfg-1",
        modelId: "local-llama",
      },
      actor,
    );

    expect(result).toEqual(named);
    expect(generateText).not.toHaveBeenCalled();
    expect(createChatModelHandle).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the topic is missing for this actor", async () => {
    findTopicForActor.mockResolvedValue(null);

    await expect(
      titleTopicFromFirstMessage(
        {
          topicId: "missing",
          providerConfigId: "cfg-1",
          modelId: "local-llama",
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(generateText).not.toHaveBeenCalled();
  });

  const untitled = {
    id: "topic-2",
    title: "New topic",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const userMessage = {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: "Tell me about onsen towns" }],
  };

  it("prefers the user's title-model preference over the client pair", async () => {
    findTopicForActor.mockResolvedValue(untitled);
    listTopicMessages.mockResolvedValue([userMessage]);
    resolveModelPreference.mockResolvedValue({
      providerConfigId: "cfg-pref",
      modelId: "pref-model",
    });
    createChatModelHandle.mockResolvedValue({ model: "handle" });
    generateText.mockResolvedValue({ text: "Onsen towns" });

    await titleTopicFromFirstMessage(
      {
        topicId: untitled.id,
        providerConfigId: "cfg-client",
        modelId: "client-model",
      },
      actor,
    );

    expect(createChatModelHandle).toHaveBeenCalledWith(
      { providerConfigId: "cfg-pref", modelId: "pref-model" },
      actor,
    );
  });

  it("falls back to the client pair when no preference is set", async () => {
    findTopicForActor.mockResolvedValue(untitled);
    listTopicMessages.mockResolvedValue([userMessage]);
    createChatModelHandle.mockResolvedValue({ model: "handle" });
    generateText.mockResolvedValue({ text: "Onsen towns" });

    await titleTopicFromFirstMessage(
      {
        topicId: untitled.id,
        providerConfigId: "cfg-client",
        modelId: "client-model",
      },
      actor,
    );

    expect(createChatModelHandle).toHaveBeenCalledWith(
      { providerConfigId: "cfg-client", modelId: "client-model" },
      actor,
    );
  });

  it("uses the truncated-text title when no pair is available at all", async () => {
    findTopicForActor.mockResolvedValue(untitled);
    listTopicMessages.mockResolvedValue([userMessage]);

    const result = await titleTopicFromFirstMessage(
      { topicId: untitled.id },
      actor,
    );

    expect(generateText).not.toHaveBeenCalled();
    expect(createChatModelHandle).not.toHaveBeenCalled();
    expect(result).toEqual(untitled);
  });

  it("skips the model call when the fallback pair is an image model", async () => {
    findTopicForActor.mockResolvedValue(untitled);
    listTopicMessages.mockResolvedValue([userMessage]);
    resolveAvailableModels.mockResolvedValue([
      {
        configId: "cfg-client",
        modelId: "client-model",
        outputModalities: ["image", "text"],
      },
    ]);

    const result = await titleTopicFromFirstMessage(
      {
        topicId: untitled.id,
        providerConfigId: "cfg-client",
        modelId: "client-model",
      },
      actor,
    );

    // generateText on an image-only model is guaranteed to fail, so the
    // service goes straight to the truncated-text title.
    expect(generateText).not.toHaveBeenCalled();
    expect(createChatModelHandle).not.toHaveBeenCalled();
    expect(result).toEqual(untitled);
  });

  it("still titles via the model for a text-capable fallback pair", async () => {
    findTopicForActor.mockResolvedValue(untitled);
    listTopicMessages.mockResolvedValue([userMessage]);
    resolveAvailableModels.mockResolvedValue([
      {
        configId: "cfg-client",
        modelId: "client-model",
        outputModalities: ["text"],
      },
    ]);
    createChatModelHandle.mockResolvedValue({ model: "handle" });
    generateText.mockResolvedValue({ text: "Onsen towns" });

    await titleTopicFromFirstMessage(
      {
        topicId: untitled.id,
        providerConfigId: "cfg-client",
        modelId: "client-model",
      },
      actor,
    );

    expect(generateText).toHaveBeenCalled();
  });

  it("honors an explicit title preference even for an image model", async () => {
    findTopicForActor.mockResolvedValue(untitled);
    listTopicMessages.mockResolvedValue([userMessage]);
    resolveModelPreference.mockResolvedValue({
      providerConfigId: "cfg-pref",
      modelId: "pref-model",
    });
    createChatModelHandle.mockResolvedValue({ model: "handle" });
    generateText.mockResolvedValue({ text: "Onsen towns" });

    await titleTopicFromFirstMessage(
      {
        topicId: untitled.id,
        providerConfigId: "cfg-client",
        modelId: "client-model",
      },
      actor,
    );

    // The short-circuit only inspects fallback pairs; an explicit
    // preference is passed to the model untouched.
    expect(generateText).toHaveBeenCalled();
    expect(resolveAvailableModels).not.toHaveBeenCalled();
  });
});
