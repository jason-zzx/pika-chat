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
        userDefaultPair: stale,
        available: [llama, gpt],
      }),
    ).toEqual(gpt);
  });

  it("falls back to the assistant default when history is missing", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: null,
        assistantDefaultPair: llama,
        userDefaultPair: gpt,
        available: [llama, gpt],
      }),
    ).toEqual(llama);
  });

  it("drops a stale history pair and uses the assistant default", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: stale,
        assistantDefaultPair: llama,
        userDefaultPair: gpt,
        available: [llama],
      }),
    ).toEqual(llama);
  });

  it("uses the user default when history and assistant default are missing", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: null,
        assistantDefaultPair: null,
        userDefaultPair: gpt,
        available: [llama, gpt],
      }),
    ).toEqual(gpt);
  });

  it("drops a stale assistant default and lands on the user default", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: null,
        assistantDefaultPair: stale,
        userDefaultPair: gpt,
        available: [llama, gpt],
      }),
    ).toEqual(gpt);
  });

  it("drops a stale user default", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: null,
        assistantDefaultPair: null,
        userDefaultPair: stale,
        available: [llama],
      }),
    ).toBeNull();
  });

  it("returns null when every pair is missing or stale", () => {
    expect(
      resolveComposerModel({
        topicLastAssistantPair: stale,
        assistantDefaultPair: stale,
        userDefaultPair: stale,
        available: [llama],
      }),
    ).toBeNull();
    expect(
      resolveComposerModel({
        topicLastAssistantPair: null,
        assistantDefaultPair: null,
        userDefaultPair: null,
        available: [llama],
      }),
    ).toBeNull();
  });
});
