import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedTooltipHost, TooltipProvider } from "@/components/ui/tooltip";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import MessageTimestamp from "./MessageTimestamp";

const NOW = new Date(2026, 8, 4, 12, 0, 0);

/** The component formats in the browser's local zone; mirror it here. */
function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function exactTitle(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: localTimeZone(),
  }).format(date);
}

describe("MessageTimestamp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the relative label with dateTime and localized exact tooltip", async () => {
    const created = new Date(2026, 8, 4, 11, 30, 0);
    const iso = created.toISOString();
    renderWithIntl(
      <TooltipProvider delay={0}>
        <MessageTimestamp createdAt={iso} />
        <SharedTooltipHost />
      </TooltipProvider>,
      { now: NOW },
    );

    const time = screen.getByText("30 minutes ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", iso);
    expect(time).not.toHaveAttribute("title");

    fireEvent.pointerEnter(time, { pointerType: "mouse" });
    fireEvent.mouseEnter(time);
    fireEvent.mouseMove(time);
    expect(
      await screen.findByText(exactTitle(created, "en"), {
        selector: "[data-slot=tooltip-content]",
      }),
    ).toBeInTheDocument();
  });

  it("renders the plural and tooltip from the zh-CN catalog", async () => {
    const created = new Date(2026, 8, 4, 11, 30, 0);
    const iso = created.toISOString();
    renderWithIntl(
      <TooltipProvider delay={0}>
        <MessageTimestamp createdAt={iso} />
        <SharedTooltipHost />
      </TooltipProvider>,
      {
        locale: "zh-CN",
        now: NOW,
      },
    );

    const time = screen.getByText("30 分钟前");
    fireEvent.pointerEnter(time, { pointerType: "mouse" });
    fireEvent.mouseEnter(time);
    fireEvent.mouseMove(time);
    expect(
      await screen.findByText(exactTitle(created, "zh-CN"), {
        selector: "[data-slot=tooltip-content]",
      }),
    ).toBeInTheDocument();
  });

  it("renders an older message as a short date in the active locale", () => {
    const created = new Date(2026, 7, 3, 12, 0, 0);
    renderWithIntl(<MessageTimestamp createdAt={created.toISOString()} />, {
      now: NOW,
    });

    const expected = new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      timeZone: localTimeZone(),
    }).format(created);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("refreshes the label on the interval and clears it on unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const iso = new Date(2026, 8, 4, 11, 59, 30).toISOString();
    const { unmount } = renderWithIntl(<MessageTimestamp createdAt={iso} />, {
      now: NOW,
    });
    expect(screen.getByText("just now")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("1 minute ago")).toBeInTheDocument();

    const clearSpy = vi.spyOn(window, "clearInterval");
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("renders nothing for missing or invalid input", () => {
    const { container } = renderWithIntl(
      <MessageTimestamp createdAt="not-a-date" />,
      { now: NOW },
    );
    expect(container).toBeEmptyDOMElement();
  });
});
