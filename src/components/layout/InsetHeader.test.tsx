import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import InsetHeader from "./InsetHeader";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function renderHeader(title?: string | null, subtitle?: string | null) {
  return renderWithIntl(
    <SidebarProvider>
      <InsetHeader title={title} subtitle={subtitle} />
    </SidebarProvider>,
  );
}

describe("InsetHeader", () => {
  it("always shows the sidebar trigger", () => {
    renderHeader();
    expect(
      screen.getByRole("button", { name: "Toggle Sidebar" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("puts the conversation title on the same row as the trigger", () => {
    renderHeader("Why the Sky Appears Blue");
    const heading = screen.getByRole("heading", {
      name: "Why the Sky Appears Blue",
    });
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    expect(heading.compareDocumentPosition(trigger)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    expect(heading.closest("header")).toContainElement(trigger);
  });

  it("renders the subtitle under the title", () => {
    renderHeader("Why the Sky Appears Blue", "gpt-4o · my-keys");
    const heading = screen.getByRole("heading", {
      name: "Why the Sky Appears Blue",
    });
    const subtitle = screen.getByText("gpt-4o · my-keys");
    expect(heading.compareDocumentPosition(subtitle)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(heading.parentElement).toContainElement(subtitle);
  });
});
