import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import SignInForm from "./SignInForm";

const { push, refresh, signInEmail, signInUsername } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signInEmail: vi.fn(),
  signInUsername: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  SIGN_IN_FAILED_KEY: "auth.signInFailed",
  authClient: {
    signIn: { email: signInEmail, username: signInUsername },
  },
}));

function submitCredentials(identifier: string): void {
  const { container } = renderWithIntl(
    <SignInForm allowRegistration={false} />,
  );
  fireEvent.change(screen.getByLabelText("Username or email"), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "password1" },
  });
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("SignInForm did not render a form");
  }
  fireEvent.submit(form);
}

describe("SignInForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("routes a 2FA-required sign-in to the challenge page, not the app", async () => {
    signInUsername.mockResolvedValue({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] },
      error: null,
    });

    submitCredentials("operator");

    await waitFor(() =>
      expect(signInUsername).toHaveBeenCalledWith({
        username: "operator",
        password: "password1",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/two-factor"));
    expect(push).not.toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps single-step sign-in for an account without 2FA", async () => {
    signInUsername.mockResolvedValue({
      data: { token: "token", redirect: false, user: { id: "user-1" } },
      error: null,
    });

    submitCredentials("operator");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(push).not.toHaveBeenCalledWith("/two-factor");
  });
});
