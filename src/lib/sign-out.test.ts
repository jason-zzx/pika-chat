import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signOut, clear, clearNav, replace } = vi.hoisted(() => ({
  signOut: vi.fn(),
  clear: vi.fn(),
  clearNav: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut } }));
vi.mock("@/lib/pending-generation-requests", () => ({
  clearPendingGenerationRequests: clear,
}));
vi.mock("@/lib/navigation-state", () => ({
  clearNavState: clearNav,
}));

import { useTemporaryTopicStore } from "@/stores/temporary-topic-store";

import { signOutAndReset } from "./sign-out";

describe("confirmed sign-out document boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useTemporaryTopicStore.setState({ temporaryTopicId: null });
    vi.stubGlobal("window", { location: { replace } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("replaces the document and clears receipts and nav state only after success", async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    await signOutAndReset();
    expect(clear).toHaveBeenCalledOnce();
    expect(clearNav).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("does not pretend a resolved Better Auth HTTP error is a logout", async () => {
    signOut.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    await expect(signOutAndReset()).rejects.toThrow("Unavailable");
    expect(clear).not.toHaveBeenCalled();
    expect(clearNav).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("deletes an active temporary topic before sign-out and clears native tracking on success", async () => {
    const order: string[] = [];
    const fetchMock = vi.fn(async () => {
      order.push("delete");
      return new Response(null, { status: 204 });
    });
    const setTemporaryTopic = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: { replace },
      pikaNative: { setTemporaryTopic },
    });
    signOut.mockImplementation(async () => {
      order.push("signOut");
      return { data: { success: true }, error: null };
    });
    useTemporaryTopicStore.setState({ temporaryTopicId: "t-temp" });

    await signOutAndReset();

    expect(order).toEqual(["delete", "signOut"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/topics/t-temp", {
      method: "DELETE",
      keepalive: false,
    });
    expect(useTemporaryTopicStore.getState().temporaryTopicId).toBeNull();
    expect(setTemporaryTopic).toHaveBeenCalledWith(null);
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("keeps temporary topic state when Better Auth sign-out fails", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const setTemporaryTopic = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: { replace },
      pikaNative: { setTemporaryTopic },
    });
    signOut.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    useTemporaryTopicStore.setState({ temporaryTopicId: "t-temp" });

    await expect(signOutAndReset()).rejects.toThrow("Unavailable");

    expect(useTemporaryTopicStore.getState().temporaryTopicId).toBe("t-temp");
    expect(setTemporaryTopic).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
