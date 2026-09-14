import { beforeEach, describe, expect, it, vi } from "vitest";

const { findTopicContextForActor, headers, notFound, redirect, resolveActor } =
  vi.hoisted(() => ({
    findTopicContextForActor: vi.fn(),
    headers: vi.fn(),
    notFound: vi.fn(),
    redirect: vi.fn(),
    resolveActor: vi.fn(),
  }));

vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/server/auth/actor", () => ({ resolveActor }));
vi.mock("@/server/services/topic.service", () => ({ findTopicContextForActor }));
vi.mock("@/components/chat/ChatView", () => ({ default: () => null }));

import AssistantTopicPage from "./page";

const context = {
  topic: { id: "t1", title: "Hello" },
  assistant: {
    id: "a1",
    systemPrompt: "be nice",
    defaultProviderConfigId: null,
    defaultModelId: null,
  },
};

/** Real `redirect()` throws to unwind the render; the mock does the same so a
 * page that keeps rendering after a redirect fails the test. */
function simulateRedirect() {
  redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
}

describe("AssistantTopicPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveActor.mockResolvedValue({ userId: "u1", role: "user", name: "Ada" });
    simulateRedirect();
  });

  it("lands on the assistant's draft when the topic is deleted or unknown", async () => {
    findTopicContextForActor.mockResolvedValue(null);

    await expect(
      AssistantTopicPage({
        params: Promise.resolve({ assistantId: "a1", topicId: "gone" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/assistant/a1");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("lands on the assistant's draft when the topic belongs elsewhere", async () => {
    findTopicContextForActor.mockResolvedValue(context);

    await expect(
      AssistantTopicPage({
        params: Promise.resolve({ assistantId: "a2", topicId: "t1" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/assistant/a2");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("renders the topic while the URL matches its assistant", async () => {
    findTopicContextForActor.mockResolvedValue(context);

    await AssistantTopicPage({
      params: Promise.resolve({ assistantId: "a1", topicId: "t1" }),
    });

    expect(redirect).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});
