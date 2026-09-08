import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FetchPageToolOutput } from "@/lib/schemas/search-provider";

import FetchToolCall, { type FetchPageToolPart } from "./FetchToolCall";

function runningPart(url?: string): FetchPageToolPart {
  return {
    type: "tool-fetchPage",
    toolCallId: "call-1",
    state: "input-available",
    input: url === undefined ? {} : { url },
  };
}

function donePart(output: FetchPageToolOutput): FetchPageToolPart {
  return {
    type: "tool-fetchPage",
    toolCallId: "call-1",
    state: "output-available",
    input: { url: "https://pika.example.com/docs" },
    output,
  };
}

const successOutput: FetchPageToolOutput = {
  provider: "exa",
  url: "https://pika.example.com/docs",
  title: "pika docs",
  content: "Full documentation text.",
  truncated: false,
};

const TOGGLE_NAME = "Toggle page fetch details";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FetchToolCall", () => {
  it("is expanded with a spinner while the fetch is running", () => {
    render(
      <FetchToolCall
        part={runningPart("https://pika.example.com/docs")}
        streaming
      />,
    );

    const trigger = screen.getByRole("button", { name: TOGGLE_NAME });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Reading page…")).toBeInTheDocument();
    // The header offers the input URL while running.
    expect(
      screen.getByRole("button", { name: "pika.example.com" }),
    ).toBeInTheDocument();
  });

  it("auto-collapses when the output arrives and shows title and provider badge", () => {
    const { rerender } = render(
      <FetchToolCall
        part={runningPart("https://pika.example.com/docs")}
        streaming
      />,
    );
    expect(
      screen.getByRole("button", { name: TOGGLE_NAME }),
    ).toHaveAttribute("aria-expanded", "true");

    rerender(<FetchToolCall part={donePart(successOutput)} />);

    const trigger = screen.getByRole("button", { name: TOGGLE_NAME });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "pika docs" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Exa")).toBeInTheDocument();
  });

  it("falls back to the domain in the header when no title is available", () => {
    render(
      <FetchToolCall
        part={donePart({
          provider: "tavily",
          url: "https://pika.example.com/docs",
          content: "text",
          truncated: false,
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "pika.example.com" }),
    ).toBeInTheDocument();
  });

  it("shows a truncated content preview when expanded", () => {
    const longContent = `${"lorem ipsum ".repeat(60)}END_MARKER`;
    render(
      <FetchToolCall
        part={donePart({
          provider: "firecrawl",
          url: "https://pika.example.com/docs",
          content: longContent,
          truncated: true,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: TOGGLE_NAME }));

    const preview = screen.getByText(/lorem ipsum/);
    expect(preview.textContent).not.toContain("END_MARKER");
    expect(preview.textContent).toHaveLength(501); // 500 chars + ellipsis
    expect(
      screen.getByText("Page content truncated for the model."),
    ).toBeInTheDocument();
  });

  it("shows the failure summary when every provider failed", () => {
    render(
      <FetchToolCall
        part={donePart({
          error: "fetch_failed",
          attemptedProviders: ["tavily", "exa"],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: TOGGLE_NAME }));

    expect(screen.getByText(/Fetch failed/)).toHaveTextContent(
      "Tried: Tavily, Exa.",
    );
  });

  it("shows the error text for an errored tool call", () => {
    const part: FetchPageToolPart = {
      type: "tool-fetchPage",
      toolCallId: "call-1",
      state: "output-error",
      input: { url: "https://pika.example.com/docs" },
      errorText: "fetch timed out",
    };
    render(<FetchToolCall part={part} />);

    fireEvent.click(screen.getByRole("button", { name: TOGGLE_NAME }));

    expect(screen.getByRole("alert")).toHaveTextContent("fetch timed out");
  });

  it("renders a persisted incomplete part as interrupted, not running", () => {
    // A stream stopped after the tool call but before its output persists
    // an input-available part; on history reload the block must not spin.
    render(<FetchToolCall part={runningPart("https://pika.example.com/docs")} />);

    const trigger = screen.getByRole("button", { name: TOGGLE_NAME });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Read interrupted")).toBeInTheDocument();
    expect(screen.queryByText(/Reading page/)).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(
      screen.getByText("The fetch did not complete."),
    ).toBeInTheDocument();
  });

  it("renders an input-streaming leftover part without a URL", () => {
    render(
      <FetchToolCall
        part={{
          type: "tool-fetchPage",
          toolCallId: "call-1",
          state: "input-streaming",
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: TOGGLE_NAME }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Read interrupted")).toBeInTheDocument();
    // No URL available: no title button, only the row toggle.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("toggles expansion from the full-row toggle, with the chevron last", () => {
    render(<FetchToolCall part={donePart(successOutput)} />);

    const toggle = screen.getByRole("button", { name: TOGGLE_NAME });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // The content row above the overlay toggle keeps pointer events off so
    // row clicks land on the toggle; only the title re-enables them.
    const row = toggle.nextElementSibling;
    expect(row).toHaveClass("pointer-events-none");
    expect(screen.getByRole("button", { name: "pika docs" })).toHaveClass(
      "pointer-events-auto",
    );
    // The expand/collapse chevron sits at the far right of the row.
    expect(row?.lastElementChild?.tagName).toBe("svg");
  });

  it("opens the external-link dialog from the title without toggling or navigating", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<FetchToolCall part={donePart(successOutput)} />);

    const toggle = screen.getByRole("button", { name: TOGGLE_NAME });
    fireEvent.click(screen.getByRole("button", { name: "pika docs" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Open external link?");
    expect(dialog).toHaveTextContent(
      "You're about to visit an external website.",
    );
    expect(dialog).toHaveTextContent("https://pika.example.com/docs");
    // The row did not toggle and nothing navigated (the open dialog inerts
    // the page, so assert on the element captured before opening).
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("opens the URL in a new tab when the dialog is confirmed", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<FetchToolCall part={donePart(successOutput)} />);

    fireEvent.click(screen.getByRole("button", { name: "pika docs" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Open link" }),
    );

    expect(openSpy).toHaveBeenCalledWith(
      "https://pika.example.com/docs",
      "_blank",
      "noreferrer",
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("closes the dialog without navigating on Close", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<FetchToolCall part={donePart(successOutput)} />);

    fireEvent.click(screen.getByRole("button", { name: "pika docs" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(openSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });
});
