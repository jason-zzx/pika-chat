import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import SignInForm from "./SignInForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("SignInForm", () => {
  it("hides the sign-up entry when registration is closed", () => {
    renderWithIntl(<SignInForm allowRegistration={false} />);
    expect(screen.queryByRole("link", { name: "Create one" })).toBeNull();
  });

  it("shows the sign-up entry when registration is open", () => {
    renderWithIntl(<SignInForm allowRegistration={true} />);
    expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
  });

  it("renders its labels from the zh-CN catalog", () => {
    renderWithIntl(<SignInForm allowRegistration={true} />, {
      locale: "zh-CN",
    });

    expect(screen.getByLabelText("用户名或邮箱")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "立即注册" }),
    ).toHaveAttribute("href", "/sign-up");
  });
});
