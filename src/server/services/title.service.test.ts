import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TOPIC_TITLE } from "@/lib/schemas/topic";
import type { Actor } from "@/server/auth/actor";

import {
  fallbackTitleFromMessage,
  sanitizeGeneratedTitle,
  TITLE_MAX_LENGTH,
  titleTopicFromFirstMessage,
} from "./title.service";

const { createChatModelHandle, findTopicForActor, generateText } = vi.hoisted(
  () => ({
    createChatModelHandle: vi.fn(),
    findTopicForActor: vi.fn(),
    generateText: vi.fn(),
  }),
);

vi.mock("@/server/ai/chat-model", () => ({
  createChatModelHandle,
}));

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
    const title = fallbackTitleFromMessage(text);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBe(TITLE_MAX_LENGTH + 1);
  });

  it("returns the default title for empty text", () => {
    expect(fallbackTitleFromMessage("   ")).toBe(DEFAULT_TOPIC_TITLE);
  });
});

describe("titleTopicFromFirstMessage", () => {
  beforeEach(() => {
    findTopicForActor.mockReset();
    generateText.mockReset();
    createChatModelHandle.mockReset();
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
});
