import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

describe("Select", () => {
  it("positions its portal wrapper with position: fixed so it never grows the document scroll area", async () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger aria-label="Pick a value">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
        </SelectContent>
      </Select>,
    );

    // Base UI opens the select on mousedown, and the open is scheduled on a
    // frame, hence the waitFor on the item.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Pick a value" }));
    const option = await screen.findByRole("option", { name: "Option B" });
    const popup = option.closest('[data-slot="select-content"]');
    const positioner = popup?.parentElement;

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
