import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import TwoFactorForm from "./TwoFactorForm";

const { verifyTotp, verifyBackupCode, push, refresh } = vi.hoisted(() => ({
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: { verifyTotp, verifyBackupCode },
  },
}));

function submitCode(code: string): void {
  const { container } = renderWithIntl(<TwoFactorForm />);
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: code } });
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("TwoFactorForm did not render a form");
  }
  fireEvent.submit(form);
}

describe("TwoFactorForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyTotp.mockResolvedValue({ data: { token: "token" }, error: null });
    verifyBackupCode.mockResolvedValue({ data: { token: "token" }, error: null });
  });

  it("sends a 6-digit code to verifyTotp", async () => {
    submitCode("123456");

    await waitFor(() =>
      expect(verifyTotp).toHaveBeenCalledWith({ code: "123456" }),
    );
    expect(verifyBackupCode).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("sends a backup-code shaped value to verifyBackupCode", async () => {
    submitCode("aB3dE-7xK9p");

    await waitFor(() =>
      expect(verifyBackupCode).toHaveBeenCalledWith({ code: "aB3dE-7xK9p" }),
    );
    expect(verifyTotp).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("shows the specific message for a rejected code and stays on the page", async () => {
    verifyBackupCode.mockResolvedValue({
      data: null,
      error: { code: "INVALID_BACKUP_CODE", message: "rejected" },
    });

    submitCode("aB3dE-7xK9p");

    await waitFor(() =>
      expect(screen.getByText("That code was not accepted")).toBeDefined(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("renders the challenge copy from the zh-CN catalog", () => {
    renderWithIntl(<TwoFactorForm />, { locale: "zh-CN" });

    expect(screen.getByLabelText("验证码")).toBeDefined();
    expect(screen.getByRole("button", { name: "验证" })).toBeDefined();
  });
});
