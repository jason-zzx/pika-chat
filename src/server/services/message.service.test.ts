import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { chatMessages } from "@/server/db/schema";

import {
  appendAssistantMessage,
  appendUserMessage,
  listTopicMessages,
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

function row(overrides: Partial<ChatMessageRow>): ChatMessageRow {
  return {
    id: "msg-1",
    topicId: "topic-1",
    role: "assistant",
    parts: [{ type: "text", text: "Answer" }],
    outcome: "completed",
    errorMessage: null,
    providerConfigId: null,
    modelId: null,
    reasoningMs: null,
    groupId: "msg-1",
    isSelected: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** Mocks the select chain used by listTopicRows. */
function mockDbSelecting(rows: ChatMessageRow[]): void {
  getDb.mockImplementation(() => ({
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: async () => rows }),
      }),
    }),
  }));
}

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
    const message = rowToChatUIMessage(
      row({
        outcome: "failed",
        errorMessage: "model does not exist",
        providerConfigId: "cfg-1",
        modelId: "gpt-4o",
        reasoningMs: 3200,
      }),
    );
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
    const message = rowToChatUIMessage(row({ id: "msg-2" }));
    expect(message.metadata).toEqual({
      outcome: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("merges version metadata into assistant messages", () => {
    const message = rowToChatUIMessage(row({}), {
      groupId: "grp-1",
      versionIndex: 2,
      versionCount: 3,
      versionIds: ["v1", "v2", "v3"],
    });
    expect(message.metadata).toMatchObject({
      groupId: "grp-1",
      versionIndex: 2,
      versionCount: 3,
      versionIds: ["v1", "v2", "v3"],
    });
  });

  it("never attaches version metadata to user rows", () => {
    const message = rowToChatUIMessage(
      row({ id: "user-1", role: "user", outcome: null }),
      {
        groupId: "user-1",
        versionIndex: 1,
        versionCount: 1,
        versionIds: ["user-1"],
      },
    );
    expect(message.metadata).toEqual({
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("gives user rows a createdAt-only metadata", () => {
    const message = rowToChatUIMessage(
      row({
        id: "user-1",
        role: "user",
        outcome: null,
        parts: [{ type: "text", text: "Hello" }],
        groupId: "user-1",
        createdAt: new Date("2026-01-01T12:34:56.000Z"),
      }),
    );
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

describe("listTopicMessages", () => {
  beforeEach(() => {
    findTopicContextForActor.mockReset();
    getDb.mockReset();
    findTopicContextForActor.mockResolvedValue({ id: "topic-1" });
  });

  it("returns single-version groups in order, one message per row", async () => {
    mockDbSelecting([
      row({
        id: "u1",
        role: "user",
        outcome: null,
        groupId: "u1",
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
      }),
      row({
        id: "a1",
        groupId: "a1",
        modelId: "gpt-4o",
        createdAt: new Date("2026-01-01T00:00:02.000Z"),
      }),
    ]);

    const messages = await listTopicMessages({ topicId: "topic-1" }, actor);

    expect(messages.map((message) => message.id)).toEqual(["u1", "a1"]);
    expect(messages[0]?.metadata).toEqual({
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    expect(messages[1]?.metadata).toMatchObject({
      groupId: "a1",
      versionIndex: 1,
      versionCount: 1,
      versionIds: ["a1"],
    });
  });

  it("returns the selected version per group with version metadata", async () => {
    mockDbSelecting([
      row({
        id: "u1",
        role: "user",
        outcome: null,
        groupId: "u1",
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
      }),
      row({
        id: "a1",
        groupId: "a1",
        isSelected: false,
        parts: [{ type: "text", text: "old" }],
        createdAt: new Date("2026-01-01T00:00:02.000Z"),
      }),
      row({
        id: "a2",
        groupId: "a1",
        isSelected: true,
        parts: [{ type: "text", text: "new" }],
        createdAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
      row({
        id: "u2",
        role: "user",
        outcome: null,
        groupId: "u2",
        createdAt: new Date("2026-01-01T00:00:04.000Z"),
      }),
    ]);

    const messages = await listTopicMessages({ topicId: "topic-1" }, actor);

    expect(messages.map((message) => message.id)).toEqual(["u1", "a2", "u2"]);
    expect(messages[1]?.metadata).toMatchObject({
      groupId: "a1",
      versionIndex: 2,
      versionCount: 2,
      versionIds: ["a1", "a2"],
    });
  });

  it("keeps the group position at its earliest version", async () => {
    // a1's group starts before u1 even though its selected version is later.
    mockDbSelecting([
      row({
        id: "a1",
        groupId: "a1",
        isSelected: false,
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
      }),
      row({
        id: "u1",
        role: "user",
        outcome: null,
        groupId: "u1",
        createdAt: new Date("2026-01-01T00:00:02.000Z"),
      }),
      row({
        id: "a2",
        groupId: "a1",
        isSelected: true,
        createdAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
    ]);

    const messages = await listTopicMessages({ topicId: "topic-1" }, actor);

    expect(messages.map((message) => message.id)).toEqual(["a2", "u1"]);
  });

  it("falls back to the latest version when a group has no selection", async () => {
    mockDbSelecting([
      row({
        id: "a1",
        groupId: "a1",
        isSelected: false,
        parts: [{ type: "text", text: "old" }],
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
      }),
      row({
        id: "a2",
        groupId: "a1",
        isSelected: false,
        parts: [{ type: "text", text: "new" }],
        createdAt: new Date("2026-01-01T00:00:02.000Z"),
      }),
    ]);

    const messages = await listTopicMessages({ topicId: "topic-1" }, actor);

    expect(messages.map((message) => message.id)).toEqual(["a2"]);
    expect(messages[0]?.metadata).toMatchObject({
      versionIndex: 2,
      versionCount: 2,
    });
  });
});

describe("appendUserMessage", () => {
  let capturedValues: ChatMessageInsert | undefined;

  beforeEach(() => {
    capturedValues = undefined;
    findTopicContextForActor.mockReset();
    getDb.mockReset();
    findTopicContextForActor.mockResolvedValue({ id: "topic-1" });
    getDb.mockImplementation(() => ({
      insert: () => ({
        values: (values: ChatMessageInsert) => {
          capturedValues = values;
          return {
            returning: async () => [
              row({
                id: values.id ?? "user-1",
                role: "user",
                outcome: null,
                groupId: values.groupId ?? "user-1",
              }),
            ],
          };
        },
      }),
    }));
  });

  it("writes groupId equal to the message id (single-version group)", async () => {
    const message = await appendUserMessage(
      {
        topicId: "topic-1",
        message: {
          id: "user-9",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      },
      actor,
    );

    expect(capturedValues).toMatchObject({ id: "user-9", groupId: "user-9" });
    expect(message.id).toBe("user-9");
  });
});

describe("appendAssistantMessage", () => {
  const assistantRow = row({
    id: "assistant-1",
    providerConfigId: "cfg-1",
    modelId: "gpt-4o",
    reasoningMs: 3200,
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
  });

  let capturedValues: ChatMessageInsert | undefined;
  let updatedWhere: unknown;

  function mockDbReturning(rowValue: ChatMessageRow): void {
    getDb.mockImplementation(() => ({
      insert: () => ({
        values: (values: ChatMessageInsert) => {
          capturedValues = values;
          return { returning: async () => [rowValue] };
        },
      }),
      transaction: async (
        fn: (tx: {
          update: () => { set: (v: unknown) => { where: (w: unknown) => Promise<void> } };
          insert: () => {
            values: (v: ChatMessageInsert) => { returning: () => Promise<ChatMessageRow[]> };
          };
        }) => Promise<unknown>,
      ) =>
        fn({
          update: () => ({
            set: () => ({
              where: async (whereClause: unknown) => {
                updatedWhere = whereClause;
              },
            }),
          }),
          insert: () => ({
            values: (values: ChatMessageInsert) => {
              capturedValues = values;
              return { returning: async () => [rowValue] };
            },
          }),
        }),
    }));
  }

  beforeEach(() => {
    capturedValues = undefined;
    updatedWhere = undefined;
    findTopicContextForActor.mockReset();
    getDb.mockReset();
    findTopicContextForActor.mockResolvedValue({ id: "topic-1" });
  });

  const baseInput = {
    topicId: "topic-1",
    message: {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Answer" }],
    },
    outcome: "completed" as const,
    providerConfigId: "cfg-1",
    modelId: "gpt-4o",
  };

  it("persists an explicit createdAt so reloads match the live stream", async () => {
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    mockDbReturning(assistantRow);

    const message = await appendAssistantMessage(
      { ...baseInput, reasoningMs: 3200, createdAt },
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

    await appendAssistantMessage(baseInput, actor);

    // Undefined inputs fall through so the column defaults apply
    // (null / defaultNow()); drizzle omits undefined values entirely.
    expect(capturedValues?.reasoningMs).toBeUndefined();
    expect(capturedValues?.createdAt).toBeUndefined();
  });

  it("starts a single-version group keyed by its own id by default", async () => {
    mockDbReturning(assistantRow);

    await appendAssistantMessage(baseInput, actor);

    expect(capturedValues?.groupId).toBe("assistant-1");
    expect(updatedWhere).toBeUndefined();
  });

  it("joins an existing group inside a transaction that deselects siblings", async () => {
    mockDbReturning(row({ ...assistantRow, id: "assistant-2", groupId: "g-1" }));

    const message = await appendAssistantMessage(
      {
        ...baseInput,
        message: { ...baseInput.message, id: "assistant-2" },
        groupId: "g-1",
      },
      actor,
    );

    expect(updatedWhere).toBeDefined();
    expect(capturedValues).toMatchObject({ id: "assistant-2", groupId: "g-1" });
    expect(message.id).toBe("assistant-2");
  });
});
