import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MessageActions from "./MessageActions";

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

describe("MessageActions", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });

  it("copies the message text and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<MessageActions text="hello world" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("hello world");
    });
    expect(await screen.findByTitle("Copied")).toBeInTheDocument();
  });

  it("shows a transient failure title when the clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    mockClipboard(writeText);
    render(<MessageActions text="hello" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    expect(await screen.findByTitle("Copy failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy message" })).toHaveAttribute(
      "aria-label",
      "Copy message",
    );
  });
});
