import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAll, redirect } = vi.hoisted(() => ({
  getAll: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll }),
}));

vi.mock("next/navigation", () => ({ redirect }));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/components/auth/TwoFactorForm", () => ({
  default: () => null,
}));

import TwoFactorPage from "./page";

describe("TwoFactorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a visitor with no pending challenge back to sign-in", async () => {
    getAll.mockReturnValue([{ name: "better-auth.session_token", value: "x" }]);

    await TwoFactorPage();

    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("renders the form while a challenge cookie is present, secure prefix included", async () => {
    getAll.mockReturnValue([{ name: "two_factor", value: "x" }]);
    await TwoFactorPage();

    // better-auth prefixes the cookie with `__Secure-` on https origins.
    getAll.mockReturnValue([{ name: "__Secure-two_factor", value: "x" }]);
    await TwoFactorPage();

    expect(redirect).not.toHaveBeenCalled();
  });
});
