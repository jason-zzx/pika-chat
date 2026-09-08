import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SearchWebToolOutput } from "@/lib/schemas/search-provider";

import SearchToolCall, { type SearchWebToolPart } from "./SearchToolCall";

function runningPart(query?: string): SearchWebToolPart {
  return {
    type: "tool-searchWeb",
    toolCallId: "call-1",
    state: "input-available",
    input: query === undefined ? {} : { query },
  };
}

function donePart(output: SearchWebToolOutput): SearchWebToolPart {
  return {
    type: "tool-searchWeb",
    toolCallId: "call-1",
    state: "output-available",
    input: { query: "pika chat repo" },
    output,
  };
}

const successOutput: SearchWebToolOutput = {
  provider: "tavily",
  query: "pika chat repo",
  results: [
    {
      title: "pika-chat on GitHub",
      url: "https://github.com/example/pika-chat",
      snippet: "repo",
    },
    {
      title: "Docs",
      url: "https://pika.example.com/docs",
      snippet: "docs",
    },
  ],
};

describe("SearchToolCall", () => {
  it("is expanded with a spinner while the search is running", () => {
    render(<SearchToolCall part={runningPart("pika chat repo")} streaming />);

    const trigger = screen.getByRole("button", {
      name: /Searching the web/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("auto-collapses when the output arrives and keeps the query in the header", () => {
    const { rerender } = render(
      <SearchToolCall part={runningPart("pika chat repo")} streaming />,
    );
    expect(
      screen.getByRole("button", { name: /Searching the web/ }),
    ).toHaveAttribute("aria-expanded", "true");

    rerender(<SearchToolCall part={donePart(successOutput)} />);

    const trigger = screen.getByRole("button", {
      name: /Searched the web/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("lists the provider and result links when expanded after finishing", () => {
    render(<SearchToolCall part={donePart(successOutput)} />);

    fireEvent.click(screen.getByRole("button", { name: /Searched the web/ }));

    expect(screen.getByText("Tavily")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /pika-chat on GitHub/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/example/pika-chat",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("github.com");
    expect(
      screen.getByRole("link", { name: /Docs/ }),
    ).toHaveTextContent("pika.example.com");
  });

  it("shows the failure summary when every provider failed", () => {
    render(
      <SearchToolCall
        part={donePart({
          error: "search_failed",
          attemptedProviders: ["tavily", "exa"],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Searched the web/ }));

    expect(screen.getByText(/Search failed/)).toHaveTextContent(
      "Tried: Tavily, Exa.",
    );
  });

  it("shows the error text for an errored tool call", () => {
    const part: SearchWebToolPart = {
      type: "tool-searchWeb",
      toolCallId: "call-1",
      state: "output-error",
      input: { query: "pika chat repo" },
      errorText: "search timed out",
    };
    render(<SearchToolCall part={part} />);

    fireEvent.click(screen.getByRole("button", { name: /Searched the web/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("search timed out");
  });

  it("renders without a query while the input is still streaming", () => {
    render(
      <SearchToolCall
        streaming
        part={{
          type: "tool-searchWeb",
          toolCallId: "call-1",
          state: "input-streaming",
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Searching the web" }),
    ).toBeInTheDocument();
  });

  it("renders a persisted incomplete part as interrupted, not running", () => {
    // A stream stopped after the tool call but before its output persists
    // an input-available part; on history reload the message is not
    // streaming, so the block must not spin forever.
    render(<SearchToolCall part={runningPart("pika chat repo")} />);

    const trigger = screen.getByRole("button", {
      name: /Search interrupted/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Searching/)).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(
      screen.getByText("The search did not complete."),
    ).toBeInTheDocument();
  });

  it("renders an input-streaming leftover part as interrupted once settled", () => {
    render(
      <SearchToolCall
        part={{
          type: "tool-searchWeb",
          toolCallId: "call-1",
          state: "input-streaming",
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Search interrupted" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("resumes spinning when an interrupted part belongs to a live stream again", () => {
    const { rerender } = render(
      <SearchToolCall part={runningPart("pika chat repo")} />,
    );
    expect(
      screen.getByRole("button", { name: /Search interrupted/ }),
    ).toBeInTheDocument();

    rerender(<SearchToolCall part={runningPart("pika chat repo")} streaming />);

    expect(
      screen.getByRole("button", { name: /Searching the web/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
