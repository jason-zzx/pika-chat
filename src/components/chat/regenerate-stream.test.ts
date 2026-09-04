import { describe, expect, it } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import {
  buildRegenPlaceholder,
  insertRegenPlaceholder,
  removeRegenPlaceholder,
  upsertRegeneratedMessage,
  type RegenerateTargetRef,
} from "./regenerate-stream";

function userMessage(id: string, text = "question"): ChatUIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantMessage(
  id: string,
  text = "answer",
  groupId?: string,
): ChatUIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
    metadata: groupId === undefined ? undefined : { groupId },
  };
}

describe("buildRegenPlaceholder", () => {
  it("replaces an assistant target and adopts its group", () => {
    const messages = [
      userMessage("u1"),
      assistantMessage("a1", "old answer", "g1"),
    ];
    const target: RegenerateTargetRef = { id: "a1", role: "assistant" };

    const plan = buildRegenPlaceholder(messages, target, 1);

    expect(plan).not.toBeNull();
    expect(plan?.groupId).toBe("g1");
    expect(plan?.replaced?.id).toBe("a1");
    expect(plan?.placeholder).toMatchObject({
      role: "assistant",
      parts: [],
      metadata: { groupId: "g1" },
    });
    expect(plan?.placeholder.id).not.toBe("a1");
  });

  it("falls back to the message id as group when no groupId metadata exists", () => {
    const messages = [userMessage("u1"), assistantMessage("a1")];
    const plan = buildRegenPlaceholder(messages, { id: "a1", role: "assistant" }, 1);

    expect(plan?.groupId).toBe("a1");
  });

  it("takes over the following assistant answer for a user target", () => {
    const messages = [
      userMessage("u1"),
      assistantMessage("a1", "old answer", "g1"),
    ];
    const plan = buildRegenPlaceholder(messages, { id: "u1", role: "user" }, 0);

    expect(plan?.groupId).toBe("g1");
    expect(plan?.replaced?.id).toBe("a1");
  });

  it("opens a fresh answer slot for a user target with no following answer", () => {
    const messages = [userMessage("u1")];
    const plan = buildRegenPlaceholder(messages, { id: "u1", role: "user" }, 0);

    expect(plan?.groupId).toBeUndefined();
    expect(plan?.replaced).toBeNull();
    expect(plan?.placeholder.metadata).toBeUndefined();
  });

  it("returns null when the target is gone from the list", () => {
    const messages = [userMessage("u1")];
    expect(
      buildRegenPlaceholder(messages, { id: "missing", role: "user" }, 5),
    ).toBeNull();
  });
});

describe("insertRegenPlaceholder / removeRegenPlaceholder", () => {
  it("swaps the replaced answer for the placeholder and restores it on failure", () => {
    const messages = [
      userMessage("u1"),
      assistantMessage("a1", "old answer", "g1"),
      userMessage("u2"),
    ];
    const plan = buildRegenPlaceholder(messages, { id: "a1", role: "assistant" }, 1);
    if (!plan) {
      throw new Error("expected a plan");
    }

    const withPlaceholder = insertRegenPlaceholder(messages, plan);
    expect(withPlaceholder.map((message) => message.id)).toEqual([
      "u1",
      plan.placeholder.id,
      "u2",
    ]);
    expect(withPlaceholder[1]?.parts).toEqual([]);

    const restored = removeRegenPlaceholder(withPlaceholder, plan);
    expect(restored).toEqual(messages);
  });

  it("inserts into a fresh answer slot and removes it on failure", () => {
    const messages = [userMessage("u1"), userMessage("u2")];
    const plan = buildRegenPlaceholder(messages, { id: "u1", role: "user" }, 0);
    if (!plan) {
      throw new Error("expected a plan");
    }

    const withPlaceholder = insertRegenPlaceholder(messages, plan);
    expect(withPlaceholder.map((message) => message.id)).toEqual([
      "u1",
      plan.placeholder.id,
      "u2",
    ]);

    const restored = removeRegenPlaceholder(withPlaceholder, plan);
    expect(restored).toEqual(messages);
  });
});

describe("upsertRegeneratedMessage", () => {
  it("replaces the placeholder with the first streamed frame and merges the groupId", () => {
    const messages = [
      userMessage("u1"),
      assistantMessage("a1", "old answer", "g1"),
    ];
    const plan = buildRegenPlaceholder(messages, { id: "a1", role: "assistant" }, 1);
    if (!plan) {
      throw new Error("expected a plan");
    }
    const withPlaceholder = insertRegenPlaceholder(messages, plan);

    const frame: ChatUIMessage = {
      id: "a2",
      role: "assistant",
      parts: [],
    };
    const upserted = upsertRegeneratedMessage(
      withPlaceholder,
      frame,
      { id: "a1", role: "assistant" },
      1,
      plan,
    );

    expect(upserted.map((message) => message.id)).toEqual(["u1", "a2"]);
    // The group id rides along so list keys (and tap-to-reveal state keyed
    // by them) stay stable from placeholder through the history reseed.
    expect(upserted[1]?.metadata?.groupId).toBe("g1");
  });

  it("updates the streaming message in place on later frames", () => {
    const messages = [userMessage("u1"), assistantMessage("a1", "old", "g1")];
    const plan = buildRegenPlaceholder(messages, { id: "a1", role: "assistant" }, 1);
    if (!plan) {
      throw new Error("expected a plan");
    }
    let current = insertRegenPlaceholder(messages, plan);
    current = upsertRegeneratedMessage(
      current,
      { id: "a2", role: "assistant", parts: [] },
      { id: "a1", role: "assistant" },
      1,
      plan,
    );
    current = upsertRegeneratedMessage(
      current,
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: "text", text: "new answer" }],
        metadata: { groupId: "g1" },
      },
      { id: "a1", role: "assistant" },
      1,
      plan,
    );

    expect(current).toHaveLength(2);
    expect(current[1]?.parts).toEqual([{ type: "text", text: "new answer" }]);
  });

  it("inserts the frame after a user target when no placeholder was built", () => {
    const messages = [userMessage("u1"), userMessage("u2")];
    const frame: ChatUIMessage = {
      id: "a2",
      role: "assistant",
      parts: [{ type: "text", text: "fresh answer" }],
    };
    const upserted = upsertRegeneratedMessage(
      messages,
      frame,
      { id: "u1", role: "user" },
      0,
    );

    expect(upserted.map((message) => message.id)).toEqual(["u1", "a2", "u2"]);
  });
});
