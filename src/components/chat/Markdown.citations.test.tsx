import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl, wrapWithIntl } from "@/test-utils/render-with-intl";

import Markdown from "./Markdown";
import type { CitationSource } from "./citations";

// Keep the heavy plugin chunks (shiki/katex/mermaid) out of the test
// runtime. Streamdown itself is NOT mocked here: the citation transform
// hooks the real remark/rehype pipeline, which runs without the plugins.
vi.mock("./markdown-plugins", () => ({
  textNeedsMermaid: () => false,
  useStreamdownPlugins: () => undefined,
}));

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

describe("Markdown citations (real Streamdown pipeline)", () => {
  it("renders resolvable [n] markers as chips; code and unknown nums stay literal", async () => {
    const { container } = renderWithIntl(
      <Markdown
        text={
          "First [1] then [2], missing [9], inline `a[1]`, fence:\n\n```txt\nx[2]\n```"
        }
        citations={sources}
      />,
    );

    // Exactly the two resolvable markers became chips…
    const chips = await screen.findAllByRole("button", {
      name: /^Source \d+: /,
    });
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAccessibleName("Source 1: pika-chat on GitHub");
    expect(chips[1]).toHaveAccessibleName("Source 2: Release notes");

    // …the out-of-range marker stayed literal text…
    expect(container.textContent).toContain("missing [9]");

    // …and neither the inline code span nor the fenced block was touched:
    // their text survives verbatim with no chip inside.
    const inlineCode = Array.from(container.querySelectorAll("code")).find(
      (element) => element.textContent === "a[1]",
    );
    expect(inlineCode).toBeDefined();
    expect(inlineCode?.querySelector("sup, button")).toBeNull();
    const fence = container.querySelector("pre");
    expect(fence?.textContent).toContain("x[2]");
    expect(fence?.querySelector("sup, button")).toBeNull();
  });

  it("keeps the no-citations path plain: no chips, no sup markers", async () => {
    const { container } = renderWithIntl(<Markdown text="plain [1] text" />);

    await screen.findByText(/plain/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("sup")).toBeNull();
    expect(container.textContent).toContain("plain [1] text");
  });

  it("renders chips for markers that stream in after the sources exist", async () => {
    const { rerender } = renderWithIntl(
      <Markdown text="Still researching…" citations={sources} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(
      wrapWithIntl(
        <Markdown text="The answer [1] is here." citations={sources} />,
      ),
    );

    expect(
      await screen.findByRole("button", {
        name: "Source 1: pika-chat on GitHub",
      }),
    ).toBeInTheDocument();
  });

  it("reparses exactly once when sources appear after the text was already rendered", async () => {
    // Streamdown's memo ignores remarkPlugins/components, so without the
    // citation key segment this block would keep [1] literal forever.
    const { container, rerender } = renderWithIntl(
      <Markdown text="The answer [1] is here." />,
    );

    // No sources yet: the marker stays literal text, no chip, no sup.
    await screen.findByText(/The answer/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("sup")).toBeNull();
    expect(container.textContent).toContain("[1]");

    // Sources arrive with the text unchanged — the remount key flips and
    // the one reparse turns the marker into a chip.
    rerender(
      wrapWithIntl(
        <Markdown text="The answer [1] is here." citations={sources} />,
      ),
    );

    expect(
      await screen.findByRole("button", {
        name: "Source 1: pika-chat on GitHub",
      }),
    ).toBeInTheDocument();
  });
});
