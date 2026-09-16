import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import CitationSup from "./CitationSup";
import { CitationSourcesContext, type CitationSource } from "./citations";

const sources: CitationSource[] = [
  {
    num: 1,
    title: "pika-chat on GitHub",
    url: "https://github.com/example/pika-chat",
    provider: "tavily",
  },
  {
    num: 2,
    title: "Release notes",
    url: "https://blog.example/release",
    provider: "exa",
  },
];

function renderSup(text: string, withSources = true) {
  const sup = <CitationSup>{text}</CitationSup>;
  return renderWithIntl(
    withSources ? (
      <CitationSourcesContext.Provider value={sources}>
        {sup}
      </CitationSourcesContext.Provider>
    ) : (
      sup
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CitationSup", () => {
  it("renders a resolvable marker as a numbered chip that opens the link dialog", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderSup("[2]");

    const chip = screen.getByRole("button", {
      name: "Source 2: Release notes",
    });
    expect(chip).toHaveTextContent("2");

    fireEvent.click(chip);
    // The external-link confirmation dialog shows the source URL…
    await screen.findByRole("alertdialog");
    expect(
      screen.getByText("https://blog.example/release"),
    ).toBeInTheDocument();

    // …and confirming opens it in a new tab.
    fireEvent.click(screen.getByRole("button", { name: /Open link/ }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://blog.example/release",
      "_blank",
      "noreferrer",
    );
  });

  it("renders an out-of-range marker as literal text", () => {
    renderSup("[9]");

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("[9]")).toBeInTheDocument();
  });

  it("splits a resolvable [n, m] group into one chip per source", () => {
    const { container } = renderSup("[1, 2]");

    const chips = screen.getAllByRole("button", { name: /^Source \d+: / });
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAccessibleName("Source 1: pika-chat on GitHub");
    expect(chips[1]).toHaveAccessibleName("Source 2: Release notes");
    // Chips sit back to back: no comma or other separator text between them.
    expect(container.textContent).toBe("12");
    expect(screen.queryByText("[1, 2]")).not.toBeInTheDocument();
  });

  it("keeps only the unresolvable num literal inside a mixed group", () => {
    const { container } = renderSup("[2, 9]");

    expect(
      screen.getByRole("button", { name: "Source 2: Release notes" }),
    ).toBeInTheDocument();
    expect(container.textContent).toBe("2[9]");
  });

  it("renders markers as literal text without a sources context", () => {
    renderSup("[1]", false);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("[1]")).toBeInTheDocument();
  });

  it("keeps default rendering for a genuine sup element", () => {
    const { container } = renderSup("not a marker");

    const sup = container.querySelector("sup");
    expect(sup).toHaveTextContent("not a marker");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
