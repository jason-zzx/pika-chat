import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { useSearchDialogStore } from "@/stores/search-dialog-store";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import SidebarSearch from "./SidebarSearch";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function renderInSidebar(ui: React.ReactElement) {
  return renderWithIntl(<SidebarProvider>{ui}</SidebarProvider>);
}

describe("SidebarSearch", () => {
  beforeEach(() => {
    useSearchDialogStore.setState({ open: false });
  });

  it("opens the search dialog when the entry input is focused or clicked", () => {
    renderInSidebar(<SidebarSearch />);

    const input = screen.getByRole("textbox", {
      name: "Search topics and messages",
    });
    expect(input).toHaveAttribute("readonly");

    fireEvent.focus(input);
    expect(useSearchDialogStore.getState().open).toBe(true);

    // A second click once the input is already focused must also open
    // (focus does not re-fire).
    useSearchDialogStore.setState({ open: false });
    fireEvent.click(input);
    expect(useSearchDialogStore.getState().open).toBe(true);
  });

  it("opens the dialog directly from the collapsed-rail icon button", () => {
    renderInSidebar(<SidebarSearch />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(useSearchDialogStore.getState().open).toBe(true);
  });
});
