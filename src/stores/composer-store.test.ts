// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { composerDraftKey, useComposerStore } from "./composer-store";

describe("composerDraftKey", () => {
  it("keys an existing topic separately from an assistant draft", () => {
    expect(composerDraftKey("topic-a", "assistant-1")).toBe("topic:topic-a");
    expect(composerDraftKey(undefined, "assistant-1")).toBe("draft:assistant-1");
    expect(composerDraftKey(undefined, undefined)).toBe("draft:none");
    expect(composerDraftKey("topic-a", "assistant-1", true)).toBe(
      "temp-topic:topic-a",
    );
    expect(composerDraftKey(undefined, "assistant-1", true)).toBe(
      "temp-draft:assistant-1",
    );
  });
});

describe("useComposerStore drafts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useComposerStore.setState({
      drafts: {},
      attachments: {},
      quotes: {},
      imageParams: {},
      recentAssistantId: null,
      pickedModel: null,
      reasoningEffort: null,
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
    expect(
      JSON.parse(window.localStorage.getItem(`pika.draft:${topicB}`) ?? "null"),
    ).toMatchObject({ text: "hello B" });

    useComposerStore.getState().setDraft(topicA, "");
    expect(useComposerStore.getState().drafts[topicA]).toBe("");
    expect(useComposerStore.getState().drafts[topicB]).toBe("hello B");
    expect(window.localStorage.getItem(`pika.draft:${topicA}`)).toBeNull();
  });

  it("does not persist temporary draft keys and clears all temporary state together", () => {
    useComposerStore.getState().setDraft("topic:t-1", "saved");
    useComposerStore.getState().setDraft("temp-draft:a1", "secret A");
    useComposerStore.getState().setDraft("temp-draft:a2", "secret B");
    useComposerStore.getState().setQuote("temp-draft:a1", {
      messageKey: "m1",
      text: "quoted",
      offset: 0,
    });
    useComposerStore.getState().setQuote("topic:t-1", {
      messageKey: "m2",
      text: "normal quote",
      offset: 0,
    });
    useComposerStore.getState().setImageParams("temp-draft:a1", { size: "1024x1024" });
    useComposerStore.getState().setImageParams("topic:t-1", { quality: "high" });

    expect(window.localStorage.getItem("pika.draft:topic:t-1")).not.toBeNull();
    expect(window.localStorage.getItem("pika.draft:temp-draft:a1")).toBeNull();
    expect(window.localStorage.getItem("pika.draft:temp-draft:a2")).toBeNull();

    useComposerStore.getState().clearTemporaryDrafts();

    expect(useComposerStore.getState().drafts["temp-draft:a1"]).toBeUndefined();
    expect(useComposerStore.getState().drafts["temp-draft:a2"]).toBeUndefined();
    expect(useComposerStore.getState().quotes["temp-draft:a1"]).toBeUndefined();
    expect(useComposerStore.getState().imageParams["temp-draft:a1"]).toBeUndefined();
    expect(useComposerStore.getState().drafts["topic:t-1"]).toBe("saved");
    expect(useComposerStore.getState().quotes["topic:t-1"]?.text).toBe(
      "normal quote",
    );
    expect(useComposerStore.getState().imageParams["topic:t-1"]).toEqual({
      quality: "high",
    });
  });

  it("stores reasoning effort separately from the model pick", () => {
    useComposerStore.getState().setReasoningEffort("high");
    expect(useComposerStore.getState().reasoningEffort).toBe("high");
    useComposerStore.getState().setReasoningEffort(null);
    expect(useComposerStore.getState().reasoningEffort).toBeNull();
  });

  it("defaults search mode to off and stores changes", () => {
    expect(useComposerStore.getState().searchMode).toBe("off");
    useComposerStore.getState().setSearchMode("tool");
    expect(useComposerStore.getState().searchMode).toBe("tool");
    useComposerStore.getState().setSearchMode("off");
    expect(useComposerStore.getState().searchMode).toBe("off");
  });
});

describe("useComposerStore quotes", () => {
  beforeEach(() => {
    useComposerStore.setState({ quotes: {} });
  });

  it("holds one quote per draft, replacing on add and clearing on null", () => {
    const topicA = composerDraftKey("topic-a", "assistant-1");
    const topicB = composerDraftKey("topic-b", "assistant-1");
    const first = { messageKey: "m1", text: "first", offset: 0 };
    const second = { messageKey: "m2", text: "second", offset: 3 };

    useComposerStore.getState().setQuote(topicA, first);
    useComposerStore.getState().setQuote(topicB, first);
    useComposerStore.getState().setQuote(topicA, second);
    expect(useComposerStore.getState().quotes[topicA]).toEqual(second);
    expect(useComposerStore.getState().quotes[topicB]).toEqual(first);

    useComposerStore.getState().setQuote(topicA, null);
    expect(useComposerStore.getState().quotes[topicA]).toBeNull();
    expect(useComposerStore.getState().quotes[topicB]).toEqual(first);
  });
});
