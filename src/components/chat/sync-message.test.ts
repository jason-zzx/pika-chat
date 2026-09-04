import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import { resolveServerMessageId } from "./sync-message";

function assistantMessage(id: string): ChatUIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text: "answer" }],
  };
}

function userMessage(id: string): ChatUIMessage {
  return { id, role: "user", parts: [{ type: "text", text: "question" }] };
}

const noSleep = () => Promise.resolve();

describe("resolveServerMessageId (B6)", () => {
  it("returns user message ids without fetching (client-owned ids)", async () => {
    const fetchHistory = vi.fn().mockRejectedValue(new Error("must not fetch"));

    const resolved = await resolveServerMessageId({
      message: userMessage("u1"),
      fetchHistory,
    });

    expect(resolved).toBe("u1");
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it("returns the id when the fresh history already contains it", async () => {
    const fetchHistory = vi
      .fn()
      .mockResolvedValue([userMessage("u1"), assistantMessage("a1")]);

    const resolved = await resolveServerMessageId({
      message: assistantMessage("a1"),
      fetchHistory,
      sleep: noSleep,
    });

    expect(resolved).toBe("a1");
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it("retries once while the server is still persisting, then resolves", async () => {
    const fetchHistory = vi
      .fn()
      .mockResolvedValueOnce([userMessage("u1")])
      .mockResolvedValueOnce([userMessage("u1"), assistantMessage("a1")]);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const resolved = await resolveServerMessageId({
      message: assistantMessage("a1"),
      fetchHistory,
      sleep,
    });

    expect(resolved).toBe("a1");
    expect(fetchHistory).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("returns null for a genuinely unknown id after the retry", async () => {
    const fetchHistory = vi.fn().mockResolvedValue([userMessage("u1")]);

    const resolved = await resolveServerMessageId({
      message: assistantMessage("ghost"),
      fetchHistory,
      sleep: noSleep,
    });

    expect(resolved).toBeNull();
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });
});
