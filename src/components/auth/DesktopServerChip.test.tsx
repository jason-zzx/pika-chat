import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import DesktopServerChip from "./DesktopServerChip";

describe("DesktopServerChip", () => {
  afterEach(() => {
    delete window.pikaNative;
  });

  it("renders nothing in a browser", () => {
    const { container } = renderWithIntl(<DesktopServerChip />);

    expect(container.innerHTML).toBe("");
  });

  it("shows the server name and opens the native menu in the desktop shell", () => {
    const showServerMenu = vi.fn();
    window.pikaNative = {
      serverName: "Home lab",
      notify: vi.fn(),
      showServerMenu,
      openServers: vi.fn(),
    };
    renderWithIntl(<DesktopServerChip />);

    fireEvent.click(
      screen.getByRole("button", { name: "Switch server, current: Home lab" }),
    );

    expect(showServerMenu).toHaveBeenCalledWith({
      x: expect.any(Number),
      y: expect.any(Number),
    });
  });
});
