import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import DemoEntry from "./DemoEntry";

const { push, refresh, signInAnonymous } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signInAnonymous: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { anonymous: signInAnonymous },
  },
}));

describe("DemoEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs in anonymously and routes to the workspace", async () => {
    signInAnonymous.mockResolvedValue({ data: { user: { id: "g1" } }, error: null });
    renderWithIntl(<DemoEntry />);

    fireEvent.click(screen.getByRole("button", { name: "Enter demo" }));

    await waitFor(() => expect(signInAnonymous).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows localized IP limit error when rate-limited", async () => {
    signInAnonymous.mockResolvedValue({
      data: null,
      error: { code: "GUEST_IP_LIMIT" },
    });
    renderWithIntl(<DemoEntry />);

    fireEvent.click(screen.getByRole("button", { name: "Enter demo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many demo sessions created from this network today.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
