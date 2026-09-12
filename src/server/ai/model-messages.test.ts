import { describe, expect, it } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import { replayModelMessages } from "./model-messages";

function assistantMessage(parts: ChatUIMessage["parts"]): ChatUIMessage {
  return { id: "a1", role: "assistant", parts };
}

describe("replayModelMessages", () => {
  it("drops an input-available tool call left behind by an interrupted stream", async () => {
    // Stream stopped after the model emitted the searchWeb call but before
    // its output: replaying the call without a result would 400 on strict
    // vendors for every follow-up turn.
    const messages: ChatUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
      assistantMessage([
        { type: "text", text: "Let me search." },
        {
          type: "tool-searchWeb",
          toolCallId: "call-1",
          state: "input-available",
          input: { query: "pika chat" },
        } as ChatUIMessage["parts"][number],
      ]),
      { id: "u2", role: "user", parts: [{ type: "text", text: "well?" }] },
    ];

    const converted = await replayModelMessages(messages);

    expect(JSON.stringify(converted)).not.toContain("tool-call");
    expect(converted.some((message) => message.role === "tool")).toBe(false);
    // The surrounding text turns still replay.
    expect(converted).toHaveLength(3);
  });

  it("drops an input-streaming leftover part as well", async () => {
    const converted = await replayModelMessages([
      assistantMessage([
        {
          type: "tool-searchWeb",
          toolCallId: "call-1",
          state: "input-streaming",
          input: {},
        } as ChatUIMessage["parts"][number],
      ]),
      { id: "u1", role: "user", parts: [{ type: "text", text: "again" }] },
    ]);

    expect(JSON.stringify(converted)).not.toContain("tool-call");
    expect(converted.some((message) => message.role === "tool")).toBe(false);
  });

  it("still replays completed tool calls with their results", async () => {
    const converted = await replayModelMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "search it" }] },
      assistantMessage([
        {
          type: "tool-searchWeb",
          toolCallId: "call-1",
          state: "output-available",
          input: { query: "pika chat" },
          output: {
            provider: "tavily",
            query: "pika chat",
            results: [
              {
                title: "pika-chat on GitHub",
                url: "https://github.com/example/pika-chat",
                snippet: "repo",
              },
            ],
          },
        } as ChatUIMessage["parts"][number],
        { type: "text", text: "Found it." },
      ]),
    ]);

    expect(JSON.stringify(converted)).toContain("tool-call");
    expect(JSON.stringify(converted)).toContain("tool-result");
    expect(converted.some((message) => message.role === "tool")).toBe(true);
  });

  it("drops an interrupted tool-fetchPage call left without an output", async () => {
    const converted = await replayModelMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "read it" }] },
      assistantMessage([
        {
          type: "tool-fetchPage",
          toolCallId: "call-1",
          state: "input-available",
          input: { url: "https://a.example" },
        } as ChatUIMessage["parts"][number],
      ]),
      { id: "u2", role: "user", parts: [{ type: "text", text: "well?" }] },
    ]);

    expect(JSON.stringify(converted)).not.toContain("tool-call");
    expect(converted.some((message) => message.role === "tool")).toBe(false);
    expect(converted).toHaveLength(2);
  });

  it("replays an inlined image file part without error", async () => {
    // Native routing hands the model a data URL rather than the internal
    // /api/files/<id> path, and that is what history replay sees on the next
    // turn (routing runs before replay, persistence keeps the file part).
    const converted = await replayModelMessages([
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "what is this?" },
          {
            type: "file",
            url: `data:image/png;base64,${Buffer.from("abc").toString("base64")}`,
            mediaType: "image/png",
            filename: "cat.png",
          },
        ],
      },
    ]);

    expect(converted).toHaveLength(1);
    expect(JSON.stringify(converted)).toContain("image/png");
  });

  it("still replays a completed tool-fetchPage call with its result", async () => {
    const converted = await replayModelMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "read it" }] },
      assistantMessage([
        {
          type: "tool-fetchPage",
          toolCallId: "call-1",
          state: "output-available",
          input: { url: "https://a.example" },
          output: {
            provider: "tavily",
            url: "https://a.example",
            content: "page text",
            truncated: false,
          },
        } as ChatUIMessage["parts"][number],
        { type: "text", text: "The page says…" },
      ]),
    ]);

    expect(JSON.stringify(converted)).toContain("tool-call");
    expect(JSON.stringify(converted)).toContain("tool-result");
    expect(converted.some((message) => message.role === "tool")).toBe(true);
  });
});
