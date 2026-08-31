import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SignInForm from "./SignInForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("SignInForm", () => {
  it("hides the sign-up entry when registration is closed", () => {
    render(<SignInForm allowRegistration={false} />);
    expect(screen.queryByRole("link", { name: "Create one" })).toBeNull();
  });

  it("shows the sign-up entry when registration is open", () => {
    render(<SignInForm allowRegistration={true} />);
    expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
  });
});
