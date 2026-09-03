import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MessageTimestamp from "./MessageTimestamp";

const NOW = new Date(2026, 8, 4, 12, 0, 0);

describe("MessageTimestamp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the relative label with dateTime and exact local title", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const iso = new Date(2026, 8, 4, 11, 30, 0).toISOString();
    render(<MessageTimestamp createdAt={iso} />);

    const time = screen.getByText("30 minutes ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", iso);
    expect(time).toHaveAttribute("title", "2026-09-04 11:30:00");
  });

  it("refreshes the label on the interval and clears it on unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const iso = new Date(2026, 8, 4, 11, 59, 30).toISOString();
    const { unmount } = render(<MessageTimestamp createdAt={iso} />);
    expect(screen.getByText("just now")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("1 minutes ago")).toBeInTheDocument();

    const clearSpy = vi.spyOn(window, "clearInterval");
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("renders nothing for missing or invalid input", () => {
    const { container } = render(<MessageTimestamp createdAt="not-a-date" />);
    expect(container).toBeEmptyDOMElement();
  });
});
