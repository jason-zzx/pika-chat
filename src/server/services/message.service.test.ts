import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { chatMessages } from "@/server/db/schema";

import {
  appendAssistantMessage,
  metadataFromRow,
  rowToChatUIMessage,
  textFromMessage,
  uiPartsFromJson,
} from "./message.service";

const { findTopicContextForActor, getDb } = vi.hoisted(() => ({
  findTopicContextForActor: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ getDb }));

vi.mock("@/server/services/topic.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/services/topic.service")>();
  return { ...actual, findTopicContextForActor };
});

const actor: Actor = { userId: "user-1", role: "user" };

type ChatMessageInsert = typeof chatMessages.$inferInsert;
type ChatMessageRow = typeof chatMessages.$inferSelect;

describe("uiPartsFromJson", () => {
  it("keeps text, reasoning, and step-start parts", () => {
    expect(
      uiPartsFromJson([
        { type: "text", text: "Hello" },
        { type: "reasoning", text: "think", id: "r1" },
        { type: "step-start" },
        { type: "unknown", extra: true },
        "nope",
      ]),
    ).toEqual([
      { type: "text", text: "Hello" },
      { type: "reasoning", text: "think", id: "r1" },
      { type: "step-start" },
    ]);
  });

  it("returns an empty array for non-arrays", () => {
    expect(uiPartsFromJson(null)).toEqual([]);
    expect(uiPartsFromJson({ type: "text" })).toEqual([]);
  });

  it("reads rows the SDK wrote with a streaming state field", () => {
    expect(
      uiPartsFromJson([
        { type: "text", text: "Answer", state: "done" },
        { type: "reasoning", text: "think", state: "done" },
      ]),
    ).toEqual([
      { type: "text", text: "Answer" },
      { type: "reasoning", text: "think" },
    ]);
  });
});

describe("rowToChatUIMessage", () => {
  it("folds assistant columns into metadata", () => {
    const message = rowToChatUIMessage({
      id: "msg-1",
      topicId: "topic-1",
      role: "assistant",
      parts: [{ type: "text", text: "Answer" }],
      outcome: "failed",
      errorMessage: "model does not exist",
      providerConfigId: "cfg-1",
      modelId: "gpt-4o",
      reasoningMs: 3200,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(message).toEqual({
      id: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "Answer" }],
      metadata: {
        outcome: "failed",
        errorMessage: "model does not exist",
        providerConfigId: "cfg-1",
        modelId: "gpt-4o",
        reasoningMs: 3200,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("omits assistant metadata that legacy rows never had", () => {
    const message = rowToChatUIMessage({
      id: "msg-2",
      topicId: "topic-1",
      role: "assistant",
      parts: [{ type: "text", text: "Answer" }],
      outcome: "completed",
      errorMessage: null,
      providerConfigId: null,
      modelId: null,
      reasoningMs: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(message.metadata).toEqual({
      outcome: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("gives user rows a createdAt-only metadata", () => {
    const message = rowToChatUIMessage({
      id: "user-1",
      topicId: "topic-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
      outcome: null,
      errorMessage: null,
      providerConfigId: null,
      modelId: null,
      reasoningMs: null,
      createdAt: new Date("2026-01-01T12:34:56.000Z"),
    });
    expect(message.metadata).toEqual({
      createdAt: "2026-01-01T12:34:56.000Z",
    });
    expect(
      metadataFromRow({
        role: "user",
        outcome: null,
        errorMessage: null,
        providerConfigId: null,
        modelId: null,
        reasoningMs: null,
        createdAt: new Date("2026-01-01T12:34:56.000Z"),
      }),
    ).toEqual({ createdAt: "2026-01-01T12:34:56.000Z" });
    expect(
      textFromMessage({
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      }),
    ).toBe("Hello world");
  });
});

describe("appendAssistantMessage", () => {
  const assistantRow: ChatMessageRow = {
    id: "assistant-1",
    topicId: "topic-1",
    role: "assistant",
    parts: [{ type: "text", text: "Answer" }],
    outcome: "completed",
    errorMessage: null,
    providerConfigId: "cfg-1",
    modelId: "gpt-4o",
    reasoningMs: 3200,
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
  };

  let capturedValues: ChatMessageInsert | undefined;

  function mockDbReturning(row: ChatMessageRow): void {
    getDb.mockImplementation(() => ({
      insert: () => ({
        values: (values: ChatMessageInsert) => {
          capturedValues = values;
          return { returning: async () => [row] };
        },
      }),
    }));
  }

  beforeEach(() => {
    capturedValues = undefined;
    findTopicContextForActor.mockReset();
    getDb.mockReset();
    findTopicContextForActor.mockResolvedValue({ id: "topic-1" });
  });

  it("persists an explicit createdAt so reloads match the live stream", async () => {
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    mockDbReturning(assistantRow);

    const message = await appendAssistantMessage(
      {
        topicId: "topic-1",
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Answer" }],
        },
        outcome: "completed",
        providerConfigId: "cfg-1",
        modelId: "gpt-4o",
        reasoningMs: 3200,
        createdAt,
      },
      actor,
    );

    expect(capturedValues).toMatchObject({
      reasoningMs: 3200,
      createdAt,
    });
    expect(message.metadata?.createdAt).toBe("2026-01-01T10:00:00.000Z");
  });

  it("omits createdAt so the column defaultNow applies", async () => {
    mockDbReturning(assistantRow);

    await appendAssistantMessage(
      {
        topicId: "topic-1",
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Answer" }],
        },
        outcome: "completed",
        providerConfigId: "cfg-1",
        modelId: "gpt-4o",
      },
      actor,
    );

    // Undefined inputs fall through so the column defaults apply
    // (null / defaultNow()); drizzle omits undefined values entirely.
    expect(capturedValues?.reasoningMs).toBeUndefined();
    expect(capturedValues?.createdAt).toBeUndefined();
  });
});
