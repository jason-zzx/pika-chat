import { describe, expect, it } from "vitest";

import type { ChatRequest } from "@/lib/schemas/chat";
import {
  regenerateRequestHash,
  requestHashFor,
  sendRequestHash,
} from "@/server/ai/generation-turn";

/**
 * Receipt digest semantics (chat task §4, review B5).
 *
 * The hash decides whether a second request id reuse is "the same request"
 * (return the accepted task) or "a different request" (409). It therefore has
 * to cover every field that changes what the model is asked — including the
 * browser time zone, which is injected into the instructions, and the edit
 * payload of an edit-and-regenerate.
 */

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    assistantId: "a-1",
    providerConfigId: "cfg-1",
    modelId: "m-1",
    message: {
      id: "u-1",
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    },
    ...overrides,
  };
}

describe("sendRequestHash", () => {
  it("is stable for the same payload regardless of key order", () => {
    expect(sendRequestHash(request())).toBe(sendRequestHash(request()));
    expect(requestHashFor({ a: 1, b: 2 })).toBe(requestHashFor({ b: 2, a: 1 }));
  });

  it("includes the browser time zone (the instructions depend on it)", () => {
    expect(sendRequestHash(request({ timeZone: "Asia/Tokyo" }))).not.toBe(
      sendRequestHash(request({ timeZone: "Europe/Berlin" })),
    );
  });
});

describe("regenerateRequestHash", () => {
  it("distinguishes an edit and a time zone from a plain regeneration", () => {
    const base = {
      topicId: "t-1",
      messageId: "m-1",
      request: { providerConfigId: "cfg-1", modelId: "m-1" },
    };
    expect(
      regenerateRequestHash({
        ...base,
        request: {
          ...base.request,
          edit: {
            id: "u-2",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "edited" }],
          },
        },
      }),
    ).not.toBe(regenerateRequestHash(base));
    expect(
      regenerateRequestHash({
        ...base,
        request: { ...base.request, timeZone: "Asia/Tokyo" },
      }),
    ).not.toBe(regenerateRequestHash(base));
  });
});
