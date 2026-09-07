import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Markdown from "./Markdown";

type MermaidOptions = {
  config: { theme: string; themeVariables?: Record<string, unknown> };
};

let lastMermaidProp: MermaidOptions | undefined;
vi.mock("streamdown", () => ({
  Streamdown: ({
    children,
    mermaid,
  }: {
    children: string;
    mermaid?: MermaidOptions;
  }) => {
    lastMermaidProp = mermaid;
    return <div data-testid="streamdown">{children}</div>;
  },
}));

// Keep the plugin chunks (shiki/katex/mermaid) out of the test runtime, but
// preserve the real textNeedsMermaid so the mermaid-keyed remount is exercised.
vi.mock("./markdown-plugins", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./markdown-plugins")>();
  return {
    ...actual,
    useStreamdownPlugins: () => undefined,
  };
});

const MERMAID_TEXT = "```mermaid\ngraph TD\n```";

function setDarkClass(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

describe("Markdown", () => {
  afterEach(() => {
    setDarkClass(false);
  });

  it("remounts a mermaid message on theme change so the diagram re-renders", async () => {
    render(<Markdown text={MERMAID_TEXT} />);
    const before = screen.getByTestId("streamdown");
    expect(lastMermaidProp?.config.theme).toBe("default");
    expect(lastMermaidProp?.config.themeVariables).toBeUndefined();

    setDarkClass(true);

    await waitFor(() =>
      expect(screen.getByTestId("streamdown")).not.toBe(before),
    );
    // Dark mode uses mermaid's `base` theme with app-palette variables: the
    // built-in `dark` theme mixes light and dark node fills (R9).
    expect(lastMermaidProp?.config.theme).toBe("base");
    expect(lastMermaidProp?.config.themeVariables?.primaryColor).toBe(
      "#171717",
    );
  });

  it("does not remount a message without a mermaid fence on theme change", async () => {
    render(<Markdown text="plain **text**" />);
    const before = screen.getByTestId("streamdown");

    setDarkClass(true);

    // The memo ignores the mermaid prop change; assert the node survives.
    await waitFor(() =>
      expect(lastMermaidProp?.config.theme).toBe("base"),
    );
    expect(screen.getByTestId("streamdown")).toBe(before);
  });
});
