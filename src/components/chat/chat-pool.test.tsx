import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStreamingTopics } from "@/lib/streaming-topics";

import {
  acquireChat,
  attachChatView,
  configureChatPool,
  hasLiveChat,
  noteRegenFinished,
  noteRegenStarted,
  noteSendStarted,
  reconnectTargetFor,
  resetChatPool,
  resumeGeneration,
} from "./chat-pool";

type TopicPart = { type: string; data: { topicId: string; streamId: string } };

const chatControl = vi.hoisted(() => ({
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  // Reconnect behaviour the test drives: "stream" (a live prefix arrives and
  // ends with onFinish) or "empty" (204: resumeStream resolves with nothing).
  resume: "stream" as "stream" | "empty",
  resumeCalls: [] as string[],
  // Constructor options of the most recently created FakeChat.
  options: undefined as
    | {
        onData?: (part: TopicPart) => void;
        onFinish?: (event: { isError: boolean }) => void;
        onError?: (error: Error) => void;
      }
    | undefined,
  // Options keyed by chat id, so a test can drive several pooled chats.
  byId: new Map<
    string,
    {
      onData?: (part: TopicPart) => void;
      onFinish?: (event: { isError: boolean }) => void;
      onError?: (error: Error) => void;
    }
  >(),
}));

vi.mock("@ai-sdk/react", () => ({
  Chat: class FakeChat {
    id: string;
    constructor(options: {
      id?: string;
      onData?: (part: TopicPart) => void;
      onFinish?: (event: { isError: boolean }) => void;
      onError?: (error: Error) => void;
    }) {
      this.id = options.id ?? "test";
      chatControl.options = options;
      if (options.id) {
        chatControl.byId.set(options.id, options);
      }
    }
    get status() {
      return chatControl.status;
    }
    async resumeStream() {
      chatControl.resumeCalls.push(this.id);
      if (chatControl.resume === "empty") {
        // The transport answered 204: the SDK reports no stream to read.
        return;
      }
      // A live reconnect: the server's prefix streams to its end.
      chatControl.status = "streaming";
      chatControl.options?.onFinish?.({ isError: false });
    }
  },
}));

function streamingTopics() {
  return renderHook(() => useStreamingTopics());
}

/** Eviction is deferred to a microtask; flush it before asserting. */
function flushEviction() {
  return new Promise<void>((resolve) => queueMicrotask(resolve));
}

beforeEach(() => {
  resetChatPool();
  chatControl.status = "ready";
  chatControl.options = undefined;
  chatControl.resume = "stream";
  chatControl.resumeCalls = [];
  chatControl.byId.clear();
});

describe("chat pool lifecycle", () => {
  it("reuses one chat per chat id", () => {
    const first = acquireChat("t1");
    expect(acquireChat("t1").chat).toBe(first.chat);
    expect(acquireChat("t2").chat).not.toBe(first.chat);
  });

  it("evicts an idle chat once its view detaches", async () => {
    const first = acquireChat("t1");
    const detach = attachChatView("t1", { onData: vi.fn(), onFinish: vi.fn() });
    detach();
    await flushEviction();
    expect(acquireChat("t1").chat).not.toBe(first.chat);
  });

  it("survives a StrictMode-style detach+reattach within the same commit", async () => {
    // StrictMode double-invokes effects: cleanup (detach) and setup
    // (re-attach) run back-to-back. A synchronous eviction would drop the
    // chat the view still renders; the deferred eviction sees the re-attach.
    const entry = acquireChat("t1");
    const detach = attachChatView("t1", { onData: vi.fn(), onFinish: vi.fn() });
    detach();
    attachChatView("t1", { onData: vi.fn(), onFinish: vi.fn() });
    await flushEviction();
    expect(acquireChat("t1").chat).toBe(entry.chat);
  });

  it("keeps a streaming chat alive after its view detaches, so returning resumes it", () => {
    chatControl.status = "streaming";
    const first = acquireChat("t1");
    const detach = attachChatView("t1", { onData: vi.fn(), onFinish: vi.fn() });
    detach();
    expect(hasLiveChat("t1")).toBe(true);
    expect(acquireChat("t1").chat).toBe(first.chat);
  });

  it("does not evict the migrated draft entry when the view re-keys to the created topic", () => {
    // The draft's send becomes topic t1 (data-topic), React runs the "draft"
    // cleanup, then the view re-attaches under "t1" — the live chat must
    // survive that cleanup.
    const draft = acquireChat("draft");
    noteSendStarted("draft");
    const detachDraft = attachChatView("draft", {
      onData: vi.fn(),
      onFinish: vi.fn(),
    });
    chatControl.status = "streaming";
    act(() => {
      chatControl.options?.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
    });

    detachDraft();

    expect(acquireChat("t1").chat).toBe(draft.chat);
  });
});

describe("chat pool streaming status", () => {
  it("marks an existing topic streaming from send until finish", () => {
    const { result } = streamingTopics();
    acquireChat("t1");
    chatControl.status = "streaming";
    act(() => {
      noteSendStarted("t1");
    });
    expect(result.current.has("t1")).toBe(true);

    chatControl.status = "ready";
    act(() => {
      chatControl.options?.onFinish?.({ isError: false });
    });
    expect(result.current.has("t1")).toBe(false);
  });

  it("marks a draft's topic when data-topic arrives, and clears a pre-stream error", () => {
    const { result } = streamingTopics();
    acquireChat("draft");
    noteSendStarted("draft");
    // Nothing to mark yet: the draft has no topic id.
    expect(result.current.size).toBe(0);

    act(() => {
      chatControl.options?.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
    });
    expect(result.current.has("t1")).toBe(true);

    // A pre-stream failure (no onFinish) must clear the icon too.
    chatControl.status = "ready";
    act(() => {
      chatControl.options?.onError?.(new Error("boom"));
    });
    expect(result.current.size).toBe(0);
    // Errored + detached = evicted.
    expect(acquireChat("t1").chat).not.toBe(undefined);
    expect(hasLiveChat("t1")).toBe(false);
  });

  it("brackets a regeneration between noteRegenStarted and noteRegenFinished", async () => {
    const { result } = streamingTopics();
    const entry = acquireChat("t1");
    act(() => {
      noteRegenStarted("t1");
    });
    expect(result.current.has("t1")).toBe(true);
    // The regen loop runs outside the Chat stream, so an idle chat with an
    // active regen still counts as live and survives detach.
    expect(hasLiveChat("t1")).toBe(true);

    act(() => {
      noteRegenFinished("t1");
    });
    expect(result.current.has("t1")).toBe(false);
    await flushEviction();
    expect(acquireChat("t1").chat).not.toBe(entry.chat);
  });
});

describe("chat pool module-level side effects", () => {
  it("invalidates the tree even with no view attached", () => {
    const bridge = {
      invalidateTree: vi.fn(),
      invalidateAfterFinish: vi.fn(),
    };
    const dispose = configureChatPool(bridge);
    acquireChat("draft");
    noteSendStarted("draft");

    act(() => {
      chatControl.options?.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
    });

    expect(bridge.invalidateTree).toHaveBeenCalled();
    dispose();
  });

  it("dispatches to the attached view's handlers after the module logic", () => {
    const view = { onData: vi.fn(), onFinish: vi.fn() };
    attachChatView("t1", { onData: view.onData, onFinish: view.onFinish });

    act(() => {
      chatControl.options?.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
    });
    expect(view.onData).toHaveBeenCalledWith({
      type: "data-topic",
      data: { topicId: "t1", streamId: "s1" },
    });

    act(() => {
      chatControl.options?.onFinish?.({ isError: true });
    });
    expect(view.onFinish).toHaveBeenCalledWith({ isError: true });
  });
});

describe("chat pool generation target", () => {
  it("keeps concurrent draft-created chats on their own reconnect targets", async () => {
    type Transport = { reconnectToStream: (options: { chatId: string }) => Promise<unknown> };
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      acquireChat("draft");
      const first = chatControl.options!;
      first.onData?.({ type: "data-topic", data: { topicId: "t1", streamId: "gen-a" } });
      acquireChat("draft");
      const second = chatControl.options!;
      second.onData?.({ type: "data-topic", data: { topicId: "t2", streamId: "gen-b" } });
      const firstTransport = (first as unknown as { transport: Transport }).transport;
      const secondTransport = (second as unknown as { transport: Transport }).transport;
      await firstTransport.reconnectToStream({ chatId: "draft" });
      expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/generations/gen-a/stream", expect.anything());
      first.onFinish?.({ isError: false });
      await secondTransport.reconnectToStream({ chatId: "draft" });
      expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/generations/gen-b/stream", expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the reconnect target addressable after a draft entry migrates to its topic", () => {
    // The SDK reconnects by the Chat's own id, which stays "draft" even after
    // the entry is re-keyed to the created topic. Looking the target up by
    // entry key would find nothing and reconnect to /api/chat instead.
    const draft = acquireChat("draft");
    noteSendStarted("draft");
    act(() => {
      chatControl.options?.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "gen-9" },
      });
    });

    expect(acquireChat("t1")).toBe(draft);
    expect(draft.chatId).toBe("draft");
    expect(reconnectTargetFor("draft")).toBe("gen-9");
    expect(reconnectTargetFor("t1")).toBe("gen-9");
  });

  it("clears the target when the turn finishes", () => {
    acquireChat("t1");
    act(() => {
      chatControl.options?.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "gen-9" },
      });
    });
    act(() => {
      chatControl.options?.onFinish?.({ isError: false });
    });
    expect(reconnectTargetFor("t1")).toBeNull();
  });

  it("releases a manual regeneration's task when the loop finishes", () => {
    const entry = acquireChat("t1");
    act(() => {
      noteRegenStarted("t1", "gen-9");
    });
    act(() => {
      noteRegenFinished("t1");
    });
    // The loop no longer follows it; discovery can re-adopt a turn that is
    // still running (the loop can die from a network error).
    expect(entry.regenActive).toBe(false);
    expect(reconnectTargetFor("t1")).toBeNull();
  });
});

describe("chat pool resume outcomes", () => {
  it("never opens two reconnects for the same entry", async () => {
    chatControl.resume = "empty";
    acquireChat("t1");
    const first = resumeGeneration("t1", "gen-9");
    // A second attempt while the first is open is refused, so a burst of
    // discovery refetches cannot race two streams into one chat.
    await expect(resumeGeneration("t1", "gen-9")).resolves.toBeUndefined();
    await first;
    expect(chatControl.resumeCalls).toHaveLength(1);
  });
});
