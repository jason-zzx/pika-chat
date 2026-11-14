import { afterEach, expect, it, vi } from "vitest";

import {
  addLiveGeneration,
  createLiveGeneration,
  resetLiveGenerations,
} from "./generation-registry";
import { createLiveStreamState } from "./generation-stream";

afterEach(() => resetLiveGenerations());

it("keeps the same producer across module re-evaluation", async () => {
  const entry = createLiveGeneration({
    state: createLiveStreamState({
      generationId: "generation", userId: "user", topicId: "topic",
      assistantMessageId: "answer",
    }),
  });
  addLiveGeneration(entry);
  vi.resetModules();
  const reloaded = await import("./generation-registry");
  expect(reloaded.getLiveGeneration("generation")).toBe(entry);
  reloaded.discardLiveGenerationsForTopic("topic");
  expect(entry.controller.signal.aborted).toBe(true);
});
