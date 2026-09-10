import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import TwoFactorCard from "./TwoFactorCard";

const {
  enable,
  verifyTotp,
  generateBackupCodes,
  disable,
  revokeOtherSessions,
  refresh,
  fetchTotpQrCode,
} = vi.hoisted(() => ({
  enable: vi.fn(),
  verifyTotp: vi.fn(),
  generateBackupCodes: vi.fn(),
  disable: vi.fn(),
  revokeOtherSessions: vi.fn(),
  refresh: vi.fn(),
  fetchTotpQrCode: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: { enable, verifyTotp, generateBackupCodes, disable },
    revokeOtherSessions,
  },
}));

vi.mock("@/lib/api/two-factor", () => ({ fetchTotpQrCode }));

const FIRST_BACKUP_CODE = "aB3dE-7xK9p";
const SECOND_BACKUP_CODE = "zZ9yY-1wW2v";
const BACKUP_CODES = [FIRST_BACKUP_CODE, SECOND_BACKUP_CODE, "qQ1wW-2eE3r"];
const PASSWORD_LABEL = "Your password";
const CONFIRM_LABEL = "Code from your authenticator app";
const REVOKE_FAILED_COPY =
  "Two-factor authentication is on, but your other sessions could not be signed out. Sign out on any other devices yourself.";

function requireForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("TwoFactorCard rendered no form");
  }
  return form;
}

function submitWith(container: HTMLElement, label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.submit(requireForm(container));
}

function startEnrollment(container: HTMLElement): void {
  submitWith(container, PASSWORD_LABEL, "password1");
}

describe("TwoFactorCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enable.mockResolvedValue({
      data: {
        method: "totp",
        totpURI:
          "otpauth://totp/Pika%20chat:operator@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Pika%20chat",
        backupCodes: BACKUP_CODES,
      },
      error: null,
    });
    verifyTotp.mockResolvedValue({ data: { token: "token" }, error: null });
    fetchTotpQrCode.mockResolvedValue({ dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" });
    revokeOtherSessions.mockResolvedValue({ data: null, error: null });
  });

  it("reveals the backup codes only after the confirmation code is accepted, then revokes other sessions", async () => {
    const { container } = renderWithIntl(<TwoFactorCard enabled={false} />);

    startEnrollment(container);

    await waitFor(() => expect(enable).toHaveBeenCalledWith({ password: "password1" }));
    await waitFor(() => expect(fetchTotpQrCode).toHaveBeenCalled());

    // The plaintext codes came back from `enable`, but the secret is still
    // unverified — they must not be on screen yet.
    expect(screen.queryByText(FIRST_BACKUP_CODE)).toBeNull();
    expect(revokeOtherSessions).not.toHaveBeenCalled();

    submitWith(container, CONFIRM_LABEL, "123456");

    await waitFor(() => expect(verifyTotp).toHaveBeenCalledWith({ code: "123456" }));
    await waitFor(() => expect(screen.getByText(FIRST_BACKUP_CODE)).toBeDefined());
    expect(screen.getByText(SECOND_BACKUP_CODE)).toBeDefined();
    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the codes hidden and other sessions alive when the confirmation code is rejected", async () => {
    verifyTotp.mockResolvedValue({
      data: null,
      error: { code: "INVALID_CODE", message: "invalid code" },
    });

    const { container } = renderWithIntl(<TwoFactorCard enabled={false} />);

    startEnrollment(container);
    await waitFor(() => expect(fetchTotpQrCode).toHaveBeenCalled());

    submitWith(container, CONFIRM_LABEL, "000000");

    await waitFor(() =>
      expect(screen.getByText("That code was not accepted")).toBeDefined(),
    );
    expect(screen.queryByText(FIRST_BACKUP_CODE)).toBeNull();
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the QR code and the manual secret before confirmation", async () => {
    const { container } = renderWithIntl(<TwoFactorCard enabled={false} />);

    startEnrollment(container);

    await waitFor(() => expect(fetchTotpQrCode).toHaveBeenCalled());
    expect(
      screen.getByAltText("QR code for your authenticator app"),
    ).toHaveAttribute("src", "data:image/svg+xml;base64,PHN2Zy8+");
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeDefined();
  });

  it("returns to the start state when enrollment is cancelled", async () => {
    const { container } = renderWithIntl(<TwoFactorCard enabled={false} />);

    startEnrollment(container);
    await waitFor(() => expect(fetchTotpQrCode).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText(PASSWORD_LABEL)).toBeDefined();
    expect(screen.queryByText("JBSWY3DPEHPK3PXP")).toBeNull();
    expect(screen.queryByText(FIRST_BACKUP_CODE)).toBeNull();
  });

  it("keeps the enabled state and reports when revoking other sessions fails", async () => {
    revokeOtherSessions.mockResolvedValue({
      data: null,
      error: { code: "INTERNAL", message: "failed" },
    });

    const { container } = renderWithIntl(<TwoFactorCard enabled={false} />);

    startEnrollment(container);
    await waitFor(() => expect(fetchTotpQrCode).toHaveBeenCalled());

    submitWith(container, CONFIRM_LABEL, "123456");

    await waitFor(() =>
      expect(screen.getByText(REVOKE_FAILED_COPY)).toBeDefined(),
    );
    expect(screen.getByText("Two-factor authentication is on.")).toBeDefined();
    expect(screen.getByText(FIRST_BACKUP_CODE)).toBeDefined();
  });

  it("does not misreport a thrown revoke call as a failed verification", async () => {
    revokeOtherSessions.mockRejectedValue(new Error("network down"));

    const { container } = renderWithIntl(<TwoFactorCard enabled={false} />);

    startEnrollment(container);
    await waitFor(() => expect(fetchTotpQrCode).toHaveBeenCalled());

    submitWith(container, CONFIRM_LABEL, "123456");

    await waitFor(() =>
      expect(screen.getByText(REVOKE_FAILED_COPY)).toBeDefined(),
    );
    expect(screen.queryByText("Unable to verify the code")).toBeNull();
    expect(screen.getByText(FIRST_BACKUP_CODE)).toBeDefined();
  });

  it("shows the enabled state straight away for an account that already has 2FA on", () => {
    renderWithIntl(<TwoFactorCard enabled />);

    expect(screen.getByText("Two-factor authentication is on.")).toBeDefined();
    // Enrollment is gone. Both management forms re-ask for the password, so
    // each input is labelled by the field, not by the action it triggers.
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getAllByLabelText(PASSWORD_LABEL)).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Generate new codes" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeDefined();
  });

  it("renders the card copy from the zh-CN catalog", () => {
    renderWithIntl(<TwoFactorCard enabled={false} />, { locale: "zh-CN" });

    expect(screen.getByText("两步验证未开启。")).toBeDefined();
    expect(screen.getByRole("button", { name: "继续" })).toBeDefined();
  });
});
