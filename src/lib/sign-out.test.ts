import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signOut, clear, replace } = vi.hoisted(() => ({
  signOut: vi.fn(),
  clear: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut } }));
vi.mock("@/lib/pending-generation-requests", () => ({
  clearPendingGenerationRequests: clear,
}));

import { signOutAndReset } from "./sign-out";

describe("confirmed sign-out document boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("window", { location: { replace } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("replaces the document and clears receipts only after success", async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    await signOutAndReset();
    expect(clear).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("does not pretend a resolved Better Auth HTTP error is a logout", async () => {
    signOut.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    await expect(signOutAndReset()).rejects.toThrow("Unavailable");
    expect(clear).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
