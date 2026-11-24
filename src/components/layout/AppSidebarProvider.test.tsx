import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidebar } from "@/components/ui/sidebar";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import AppSidebarProvider from "./AppSidebarProvider";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function SidebarProbe() {
  const { state } = useSidebar();
  return <div data-testid="sidebar-probe" data-state={state} />;
}

describe("AppSidebarProvider", () => {
  beforeEach(() => {
    document.cookie = "sidebar_state=; path=/; max-age=0";
  });

  it("toggles sidebar state with the keyboard shortcut and persists the cookie", () => {
    renderWithIntl(
      <AppSidebarProvider defaultOpen={false}>
        <SidebarProbe />
      </AppSidebarProvider>,
    );

    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-state",
      "collapsed",
    );

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByTestId("sidebar-probe")).toHaveAttribute(
      "data-state",
      "expanded",
    );
    expect(document.cookie).toContain("sidebar_state=true");
  });
});
