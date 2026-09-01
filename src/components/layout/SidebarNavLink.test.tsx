import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import SidebarNavLink from "./SidebarNavLink";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

describe("SidebarNavLink", () => {
  it("closes the mobile drawer on click", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarNavLink href="/settings">Settings</SidebarNavLink>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const link = screen.getByRole("link", { name: "Settings" });
    fireEvent.click(link);
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
