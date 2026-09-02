import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";

import InsetHeader from "./InsetHeader";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function renderHeader(title?: string | null) {
  return render(
    <SidebarProvider>
      <InsetHeader title={title} />
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
    expect(heading.parentElement).toContainElement(trigger);
  });
});
