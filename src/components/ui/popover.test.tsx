import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("Popover", () => {
  it("positions its portal wrapper with position: fixed so it never grows the document scroll area", async () => {
    render(
      <Popover>
        <PopoverTrigger>Open popover</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open popover" }));
    const popup = await screen.findByText("Popover body");
    const positioner = popup.parentElement;

    // Base UI renders a `position: fixed; opacity: 0` fallback before its
    // first positioning pass; the transform only appears once floating-ui
    // has computed the placement, so gate the assertion on it.
    await vi.waitFor(() => {
      expect(positioner?.getAttribute("style")).toContain(
        "transform: translate",
      );
    });
    expect(positioner).toHaveStyle({ position: "fixed" });
  });
});
