import { describe, expect, it } from "vitest";

import {
  metadataFromRow,
  rowToChatUIMessage,
  textFromMessage,
  uiPartsFromJson,
} from "./message.service";

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
      },
    });
  });

  it("leaves user rows without metadata", () => {
    expect(
      metadataFromRow({
        role: "user",
        outcome: null,
        errorMessage: null,
        providerConfigId: null,
        modelId: null,
      }),
    ).toBeUndefined();
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
