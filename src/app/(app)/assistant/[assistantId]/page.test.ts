import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

const { headers, notFound, redirect, requireOwnedAssistant, resolveActor } =
  vi.hoisted(() => ({
    headers: vi.fn(),
    notFound: vi.fn(),
    redirect: vi.fn(),
    requireOwnedAssistant: vi.fn(),
    resolveActor: vi.fn(),
  }));

vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/server/auth/actor", () => ({ resolveActor }));
vi.mock("@/server/services/assistant.service", () => ({
  requireOwnedAssistant,
}));
vi.mock("@/components/chat/ChatView", () => ({ default: () => null }));

import AssistantDraftPage from "./page";

/** Real `redirect()` throws to unwind the render; the mock does the same so a
 * page that keeps rendering after a redirect fails the test. */
function simulateRedirect() {
  redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
}

describe("AssistantDraftPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveActor.mockResolvedValue({ userId: "u1", role: "user", name: "Ada" });
    simulateRedirect();
  });

  it("sends a deleted assistant to the home draft instead of a 404", async () => {
    requireOwnedAssistant.mockRejectedValue(
      new AppError("NOT_FOUND", 404, "assistant.notFound"),
    );

    await expect(
      AssistantDraftPage({ params: Promise.resolve({ assistantId: "gone" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("renders the draft while the assistant exists", async () => {
    requireOwnedAssistant.mockResolvedValue({
      id: "a1",
      defaultProviderConfigId: null,
      defaultModelId: null,
    });

    await AssistantDraftPage({
      params: Promise.resolve({ assistantId: "a1" }),
    });

    expect(redirect).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});
