import { readUIMessageStream } from "ai";
import { describe, expect, it } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import {
  applyChunk,
  createLiveStreamState,
  finishedMessageChunks,
  persistableParts,
  resumePrefixChunks,
  type ChatChunk,
  type LiveStreamState,
} from "@/server/ai/generation-stream";

/**
 * The resume contract (chat task §2/§6, G1): a client that reconnects mid
 * answer must receive the current state as standard UI-message chunks and then
 * the live increments, ending up with ONE message whose text is the whole
 * answer — no duplicated part, no duplicated message, no lost prefix.
 *
 * The receiving side here is the SDK's own `readUIMessageStream`, so the
 * assertion is about protocol compatibility, not about our bookkeeping.
 */

function state(): LiveStreamState {
  return createLiveStreamState({
    generationId: "gen-1",
    userId: "user-1",
    topicId: "topic-1",
    assistantMessageId: "msg-1",
  });
}

async function reduce(chunks: ChatChunk[]): Promise<ChatUIMessage> {
  const stream = new ReadableStream<ChatChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  let last: ChatUIMessage | undefined;
  for await (const message of readUIMessageStream<ChatUIMessage>({
    stream: stream as ReadableStream<never>,
    terminateOnError: true,
  })) {
    last = message;
  }
  if (!last) {
    throw new Error("no message produced");
  }
  return last;
}

function textOf(message: ChatUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

describe("resume prefix", () => {
  it("replays the current answer and continues the same part to ABCD", async () => {
    const live = state();
    applyChunk(live, { type: "start", messageId: "msg-1" });
    applyChunk(live, { type: "text-start", id: "txt-1" });
    applyChunk(live, { type: "text-delta", id: "txt-1", delta: "A" });
    applyChunk(live, { type: "text-delta", id: "txt-1", delta: "B" });
    applyChunk(live, { type: "text-delta", id: "txt-1", delta: "C" });

    const prefix = resumePrefixChunks(live);
    // The handoff frames the topic (so a resumed view keeps its stop handle)
    // and the stable message id, then the open text part — left open on
    // purpose so the live deltas below continue it.
    expect(prefix[0]).toMatchObject({
      type: "data-topic",
      data: { topicId: "topic-1", streamId: "gen-1" },
    });
    expect(prefix[1]).toMatchObject({ type: "start", messageId: "msg-1" });
    expect(prefix.some((chunk) => chunk.type === "text-end")).toBe(false);

    // The producer then emits the rest of the same part.
    applyChunk(live, { type: "text-delta", id: "txt-1", delta: "D" });
    applyChunk(live, { type: "text-end", id: "txt-1" });
    // A late reconnect must not reopen the finished part.
    expect(
      resumePrefixChunks(live).some((chunk) => chunk.type === "text-end"),
    ).toBe(true);
    const tail: ChatChunk[] = [
      { type: "text-delta", id: "txt-1", delta: "D" },
      { type: "text-end", id: "txt-1" },
    ];

    const resumed = await reduce([...prefix, ...tail]);
    expect(resumed.id).toBe("msg-1");
    expect(textOf(resumed)).toBe("ABCD");
    // One text part: the prefix replaced rather than appended.
    expect(
      resumed.parts.filter((part) => part.type === "text"),
    ).toHaveLength(1);
  });

  it("replays an in-flight tool call with its partial input", async () => {
    const live = state();
    applyChunk(live, { type: "start", messageId: "msg-1" });
    applyChunk(live, {
      type: "tool-input-start",
      toolCallId: "call-1",
      toolName: "fetchPage",
    });
    applyChunk(live, {
      type: "tool-input-delta",
      toolCallId: "call-1",
      inputTextDelta: '{"url":"https://exa',
    });

    const chunks = resumePrefixChunks(live);
    expect(chunks).toContainEqual({
      type: "tool-input-start",
      toolCallId: "call-1",
      toolName: "fetchPage",
    });
    expect(chunks).toContainEqual({
      type: "tool-input-delta",
      toolCallId: "call-1",
      inputTextDelta: '{"url":"https://exa',
    });
    const message = await reduce(chunks);
    const tool = message.parts.find(
      (part) => part.type === "tool-fetchPage",
    ) as { state?: string } | undefined;
    expect(tool?.state).toBe("input-streaming");
  });

  it("announces no topic for a regeneration", () => {
    const live = createLiveStreamState({
      generationId: "gen-2",
      userId: "user-1",
      topicId: "topic-1",
      assistantMessageId: "msg-2",
      announceTopic: false,
    });
    expect(
      resumePrefixChunks(live).some((chunk) => chunk.type === "data-topic"),
    ).toBe(false);
  });
});

describe("finished replay", () => {
  it("replays a persisted answer once, with its final metadata", async () => {
    const chunks = finishedMessageChunks({
      generationId: "gen-1",
      topicId: "topic-1",
      message: {
        id: "msg-1",
        role: "assistant",
        parts: [
          { type: "text", text: "final answer" },
          { type: "reasoning", text: "thought", id: "r-1" },
        ],
        metadata: { outcome: "completed", modelId: "m-1" },
      },
    });

    const message = await reduce(chunks);
    expect(textOf(message)).toBe("final answer");
    expect(message.metadata?.outcome).toBe("completed");
    expect(message.metadata?.modelId).toBe("m-1");
    const reasoning = message.parts.find((part) => part.type === "reasoning");
    expect(reasoning).toMatchObject({ text: "thought" });
  });
});

/**
 * Single assembly path (chat task §3/§7, review B8):
 *
 * The live state is the ONLY place the answer is assembled — the SDK's own
 * `onEnd` message is not a second source. These cases pin the chunk shapes that
 * used to be dropped or lost on resume by the hand-written reducer.
 */
describe("single assembly path", () => {
  it("keeps a tool call that never announced itself with tool-input-start", async () => {
    const live = state();
    applyChunk(live, { type: "start", messageId: "msg-1" });
    // Provider-executed tools (built-in web search) arrive as a bare
    // `tool-input-available`; there is no earlier start chunk to index it.
    applyChunk(live, {
      type: "tool-input-available",
      toolCallId: "call-9",
      toolName: "web_search",
      input: { query: "news" },
      providerExecuted: true,
    });
    applyChunk(live, {
      type: "tool-output-available",
      toolCallId: "call-9",
      output: { results: 3 },
    });
    // Attribution can also first arrive with the input after a plain start.
    applyChunk(live, { type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" });
    applyChunk(live, { type: "tool-input-available", toolCallId: "call-1", toolName: "web_search", input: {}, providerExecuted: true });

    const parts = persistableParts(live);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({
      type: "tool-web_search",
      toolCallId: "call-9",
      state: "output-available",
      providerExecuted: true,
      input: { query: "news" },
      output: { results: 3 },
    });

    // …and a reconnect replays it, preserving the execution attribution.
    const chunks = resumePrefixChunks(live);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-input-start",
        toolCallId: "call-9",
        providerExecuted: true,
      }),
    );
    const message = await reduce(chunks);
    expect(
      message.parts.find((part) => part.type === "tool-web_search"),
    ).toMatchObject({ toolCallId: "call-9", providerExecuted: true, output: { results: 3 } });
    expect(
      message.parts.find(
        (part) => part.type === "tool-web_search" && part.toolCallId === "call-1",
      ),
    ).toMatchObject({ providerExecuted: true });
  });

  it("replays a source-document citation", () => {
    const live = state();
    applyChunk(live, { type: "start", messageId: "msg-1" });
    applyChunk(live, {
      type: "source-document",
      sourceId: "doc-1",
      mediaType: "application/pdf",
      title: "Annual report",
      filename: "report.pdf",
    });

    expect(resumePrefixChunks(live)).toContainEqual({
      type: "source-document",
      sourceId: "doc-1",
      mediaType: "application/pdf",
      title: "Annual report",
      filename: "report.pdf",
    });
  });

  it("zips per-phase reasoning durations onto the reasoning parts at finish", () => {
    const live = state();
    applyChunk(live, { type: "start", messageId: "msg-1" });
    applyChunk(live, { type: "reasoning-start", id: "r-1" });
    applyChunk(live, { type: "reasoning-delta", id: "r-1", delta: "one" });
    applyChunk(live, { type: "reasoning-end", id: "r-1" });
    // A stop or crash before finish still keeps the phase duration.
    applyChunk(live, { type: "message-metadata", messageMetadata: { reasoningDurations: [1200], reasoningMs: 1200 } });
    expect(persistableParts(live)).toMatchObject([{ type: "reasoning", durationMs: 1200 }]);
    applyChunk(live, { type: "start-step" });
    applyChunk(live, { type: "reasoning-start", id: "r-2" });
    applyChunk(live, { type: "reasoning-delta", id: "r-2", delta: "two" });
    applyChunk(live, { type: "reasoning-end", id: "r-2" });
    applyChunk(live, {
      type: "finish",
      messageMetadata: {
        reasoningDurations: [1200, 800],
        reasoningMs: 2000,
        totalTokens: 30,
        finishReason: "stop",
      },
    });

    const reasoning = persistableParts(live).filter(
      (part) => part.type === "reasoning",
    );
    expect(reasoning).toMatchObject([
      { id: "r-1", durationMs: 1200, text: "one" },
      { id: "r-2", durationMs: 800, text: "two" },
    ]);
    expect(live.message.metadata).toMatchObject({
      totalTokens: 30,
      finishReason: "stop",
      reasoningMs: 2000,
    });
  });
});
