import { beforeEach, describe, expect, it } from "vitest";

import { composerDraftKey, useComposerStore } from "./composer-store";

describe("composerDraftKey", () => {
  it("keys an existing topic separately from an assistant draft", () => {
    expect(composerDraftKey("topic-a", "assistant-1")).toBe("topic:topic-a");
    expect(composerDraftKey(undefined, "assistant-1")).toBe("draft:assistant-1");
    expect(composerDraftKey(undefined, undefined)).toBe("draft:none");
  });
});

describe("useComposerStore drafts", () => {
  beforeEach(() => {
    useComposerStore.setState({
      drafts: {},
      recentAssistantId: null,
      pickedModel: null,
    });
  });

  it("keeps drafts isolated per conversation key", () => {
    const topicA = composerDraftKey("topic-a", "assistant-1");
    const topicB = composerDraftKey("topic-b", "assistant-1");
    const draftA = composerDraftKey(undefined, "assistant-1");

    useComposerStore.getState().setDraft(topicA, "hello A");
    useComposerStore.getState().setDraft(topicB, "hello B");
    useComposerStore.getState().setDraft(draftA, "new topic");

    expect(useComposerStore.getState().drafts[topicA]).toBe("hello A");
    expect(useComposerStore.getState().drafts[topicB]).toBe("hello B");
    expect(useComposerStore.getState().drafts[draftA]).toBe("new topic");

    useComposerStore.getState().setDraft(topicA, "");
    expect(useComposerStore.getState().drafts[topicA]).toBe("");
    expect(useComposerStore.getState().drafts[topicB]).toBe("hello B");
  });
});
