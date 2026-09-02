import { describe, expect, it } from "vitest";

import { resolveComposerModel } from "./resolve-composer-model";

const llama = { configId: "cfg-own", modelId: "local-llama" };
const gpt = { configId: "cfg-shared", modelId: "gpt-4o" };
const stale = { configId: "gone", modelId: "missing" };

describe("resolveComposerModel", () => {
  it("prefers the topic's last assistant pair when it is still available", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: gpt,
        assistantDefaultPair: llama,
        available: [llama, gpt],
      }),
    ).toEqual(gpt);
  });

  it("falls back to the assistant default when history is missing", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: null,
        assistantDefaultPair: llama,
        available: [llama, gpt],
      }),
    ).toEqual(llama);
  });

  it("drops a stale history pair and uses the assistant default", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: stale,
        assistantDefaultPair: llama,
        available: [llama],
      }),
    ).toEqual(llama);
  });

  it("returns null when both pairs are missing or stale", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: stale,
        assistantDefaultPair: stale,
        available: [llama],
      }),
    ).toBeNull();
    expect(
      resolveComposerModel({
        topicLastAssistantPair: null,
        assistantDefaultPair: null,
        available: [llama],
      }),
    ).toBeNull();
  });
});
