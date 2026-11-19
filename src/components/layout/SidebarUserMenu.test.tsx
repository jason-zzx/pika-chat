import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import SidebarUserMenu from "./SidebarUserMenu";

const account = { name: "Ada", role: "user" } as const;

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

function openMenu(local = false) {
  renderWithIntl(
    <TooltipProvider>
      <SidebarProvider>
        <SidebarUserMenu {...account} local={local} />
      </SidebarProvider>
    </TooltipProvider>,
  );
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Account menu for Ada" }),
    { key: "ArrowDown" },
  );
}

describe("SidebarUserMenu server switching", () => {
  afterEach(() => {
    delete window.pikaNative;
  });

  it("has no server entry in a browser", async () => {
    openMenu();

    await screen.findByRole("menuitem", { name: "Sign out" });
    expect(screen.queryByRole("menuitem", { name: /Switch server/ })).toBeNull();
  });

  it("lists the current server and opens server management in the desktop shell", async () => {
    const openServers = vi.fn();
    window.pikaNative = {
      serverName: "Home lab",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers,
    };
    openMenu();

    expect(
      await screen.findByText(`Home lab · ${window.location.host}`),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Switch server…/ }),
    );

    expect(openServers).toHaveBeenCalledWith("list");
  });

  it("hides sign-out and omits host from server label in local mode", async () => {
    window.pikaNative = {
      serverName: "This computer",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
    };
    openMenu(true);

    expect(await screen.findByText("This computer")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
  });
});
