import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SearchWebToolOutput } from "@/lib/schemas/search-provider";
import { renderWithIntl, wrapWithIntl } from "@/test-utils/render-with-intl";

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
      publishedDate: "2026-09-12",
    },
    {
      title: "Docs",
      url: "https://pika.example.com/docs",
      snippet: "docs",
    },
    {
      title: "Undated garbage",
      url: "https://pika.example.com/old",
      snippet: "old",
      publishedDate: "not-a-date",
    },
  ],
};

describe("SearchToolCall", () => {
  it("is expanded with a spinner while the search is running", () => {
    renderWithIntl(<SearchToolCall part={runningPart("pika chat repo")} streaming />);

    const trigger = screen.getByRole("button", {
      name: /Searching the web/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("auto-collapses when the output arrives and keeps the query in the header", () => {
    const { rerender } = renderWithIntl(
      <SearchToolCall part={runningPart("pika chat repo")} streaming />,
    );
    expect(
      screen.getByRole("button", { name: /Searching the web/ }),
    ).toHaveAttribute("aria-expanded", "true");

    rerender(
      wrapWithIntl(<SearchToolCall part={donePart(successOutput)} />),
    );

    const trigger = screen.getByRole("button", {
      name: /Searched the web/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("lists the provider and result links when expanded after finishing", () => {
    renderWithIntl(<SearchToolCall part={donePart(successOutput)} />);

    fireEvent.click(screen.getByRole("button", { name: /Searched the web/ }));

    expect(screen.getByText("Tavily")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /pika-chat on GitHub/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/example/pika-chat",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("github.com");
    // The provider-reported date renders next to the host.
    expect(link).toHaveTextContent("Sep 12, 2026");
    expect(
      screen.getByRole("link", { name: /Docs/ }),
    ).toHaveTextContent("pika.example.com");
    // An unparseable publishedDate hides instead of rendering garbage.
    expect(
      screen.getByRole("link", { name: /Undated garbage/ }),
    ).not.toHaveTextContent("·");
  });

  it("shows the failure summary when every provider failed", () => {
    renderWithIntl(
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
    renderWithIntl(<SearchToolCall part={part} />);

    fireEvent.click(screen.getByRole("button", { name: /Searched the web/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("search timed out");
  });

  it("renders without a query while the input is still streaming", () => {
    renderWithIntl(
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
    renderWithIntl(<SearchToolCall part={runningPart("pika chat repo")} />);

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
    renderWithIntl(
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
    const { rerender } = renderWithIntl(
      <SearchToolCall part={runningPart("pika chat repo")} />,
    );
    expect(
      screen.getByRole("button", { name: /Search interrupted/ }),
    ).toBeInTheDocument();

    rerender(
      wrapWithIntl(
        <SearchToolCall part={runningPart("pika chat repo")} streaming />,
      ),
    );

    expect(
      screen.getByRole("button", { name: /Searching the web/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
