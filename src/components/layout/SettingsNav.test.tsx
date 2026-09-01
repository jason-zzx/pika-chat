import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SettingsNav from "./SettingsNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/general",
}));

describe("SettingsNav", () => {
  it("hides the users tab for a user-role actor", () => {
    render(<SettingsNav showUsers={false} />);
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
      "href",
      "/settings/general",
    );
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/settings/account",
    );
    expect(screen.getByRole("link", { name: "Providers" })).toHaveAttribute(
      "href",
      "/settings/providers",
    );
  });

  it("shows the users tab for staff", () => {
    render(<SettingsNav showUsers={true} />);
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "href",
      "/settings/users",
    );
    expect(screen.getByRole("link", { name: "Providers" })).toHaveAttribute(
      "href",
      "/settings/providers",
    );
  });

  it("marks the active tab", () => {
    render(<SettingsNav showUsers={true} />);
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
