import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar, SidebarRail, useSidebar } from "@/components/ui/sidebar";
import { renderWithIntl, wrapWithIntl } from "@/test-utils/render-with-intl";

import AppSidebarProvider from "./AppSidebarProvider";

let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function SidebarProbe() {
  const { state, lockedOpen } = useSidebar();
  return (
    <div data-testid="sidebar-probe" data-state={state} data-locked={String(lockedOpen)} />
  );
}

describe("AppSidebarProvider", () => {
  beforeEach(() => {
    mockPathname = "/";
    document.cookie = "sidebar_state=; path=/; max-age=0";
  });

  it("forces the sidebar open on settings routes without clobbering collapsed chat state", () => {
    const view = renderWithIntl(
      <AppSidebarProvider defaultOpen={false}>
        <Sidebar>
          <SidebarRail />
        </Sidebar>
        <SidebarProbe />
      </AppSidebarProvider>,
    );

    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-state",
      "collapsed",
    );
    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-locked",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Toggle Sidebar" }),
    ).toBeInTheDocument();

    mockPathname = "/settings/general";
    view.rerender(
      wrapWithIntl(
        <AppSidebarProvider defaultOpen={false}>
          <Sidebar>
            <SidebarRail />
          </Sidebar>
          <SidebarProbe />
        </AppSidebarProvider>,
      ),
    );

    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-state",
      "expanded",
    );
    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-locked",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Toggle Sidebar" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-state",
      "expanded",
    );
    expect(document.cookie).not.toContain("sidebar_state=");

    mockPathname = "/";
    view.rerender(
      wrapWithIntl(
        <AppSidebarProvider defaultOpen={false}>
          <Sidebar>
            <SidebarRail />
          </Sidebar>
          <SidebarProbe />
        </AppSidebarProvider>,
      ),
    );

    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-state",
      "collapsed",
    );
    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-locked",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Toggle Sidebar" }),
    ).toBeInTheDocument();
  });
});
