import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addLiveGeneration,
  createLiveGeneration,
  discardLiveGenerationsForTopic,
  getLiveGeneration,
  publishChunk,
  resetLiveGenerations,
  subscribeToLiveGeneration,
  type LiveGeneration,
} from "./generation-registry";
import {
  applyChunk,
  createLiveStreamState,
  type ChatChunk,
} from "./generation-stream";

function fixture() {
  const entry: LiveGeneration = createLiveGeneration({
    state: createLiveStreamState({
      generationId: "generation", userId: "user", topicId: "topic",
      assistantMessageId: "answer",
    }),
  });
  let controller: ReadableStreamDefaultController<ChatChunk>;
  const close = vi.fn(() => controller.close());
  const stream = new ReadableStream<ChatChunk>({
    start(c) {
      controller = c;
      subscribeToLiveGeneration(entry, [], {
        push: (chunk) => c.enqueue(chunk),
        pendingChunks: () => Math.max(0, 1 - (c.desiredSize ?? 0)),
        close,
      });
    },
  });
  return { entry, stream, close };
}

const chunk: ChatChunk = { type: "text-delta", id: "text", delta: "x" };

afterEach(() => resetLiveGenerations());

it("keeps the same producer across module re-evaluation", async () => {
  const { entry } = fixture();
  addLiveGeneration(entry);
  vi.resetModules();
  const reloaded = await import("./generation-registry");
  expect(reloaded.getLiveGeneration("generation")).toBe(entry);
  reloaded.discardLiveGenerationsForTopic("topic");
  expect(entry.controller.signal.aborted).toBe(true);
});

describe("generation subscriber backlog", () => {
  it("does not truncate a healthy subscriber after 1024 lifetime chunks", async () => {
    const { entry, stream, close } = fixture();
    const reader = stream.getReader();
    for (let i = 0; i < 2048; i++) {
      publishChunk(entry, chunk);
      expect(await reader.read()).toEqual({ done: false, value: chunk });
    }
    expect(close).not.toHaveBeenCalled();
    expect(entry.subscribers.size).toBe(1);
    await reader.cancel();
  });

  it("drops an unread subscriber, not the producer or a healthy sibling", () => {
    const { entry, close } = fixture();
    const push = vi.fn();
    const healthyClose = vi.fn();
    subscribeToLiveGeneration(entry, [], {
      push, pendingChunks: () => 0, close: healthyClose,
    });
    for (let i = 0; i < 2048; i++) publishChunk(entry, chunk);
    expect(close).toHaveBeenCalledOnce();
    expect(healthyClose).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(2048);
    expect(entry.subscribers.size).toBe(1);
    expect(entry.controller.signal.aborted).toBe(false);
  });
});

describe("deleted target lifecycle", () => {
  it("clears the live content, closes subscribers and aborts the producer", () => {
    const { entry, close } = fixture();
    addLiveGeneration(entry);
    applyChunk(entry.state, { type: "start", messageId: "answer" });
    applyChunk(entry.state, { type: "text-start", id: "text-1" });
    applyChunk(entry.state, { type: "text-delta", id: "text-1", delta: "par" });
    expect(entry.state.message.parts).toHaveLength(1);

    discardLiveGenerationsForTopic("topic");

    // A deleted topic must not keep its answer in memory, hand it to a late
    // resume, or keep paying the provider for it.
    expect(entry.discarded).toBe(true);
    expect(entry.state.message.parts).toEqual([]);
    expect(close).toHaveBeenCalled();
    expect(entry.subscribers.size).toBe(0);
    expect(entry.controller.signal.aborted).toBe(true);
    // The entry stays registered until the turn's finalize closes it, so late
    // chunks are dropped rather than resurrecting a removed message.
    expect(getLiveGeneration("generation")).toBe(entry);
  });
});
