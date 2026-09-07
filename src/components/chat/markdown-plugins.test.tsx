import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMathPlugin } from "@streamdown/math";

import { textNeedsMermaid, useStreamdownPlugins } from "./markdown-plugins";

// Stub the plugin packages: the real modules pull in shiki/katex/mermaid,
// which must never load in the test runtime.
vi.mock("@streamdown/code", () => ({
  code: { name: "code", type: "code-highlighter" },
}));
vi.mock("@streamdown/math", () => ({
  createMathPlugin: vi.fn((options: unknown) => ({
    name: "math",
    type: "math",
    options,
  })),
}));
vi.mock("@streamdown/cjk", () => ({
  cjk: { name: "cjk" },
}));
const mockMermaidModuleLoaded = vi.fn();
vi.mock("@streamdown/mermaid", () => {
  mockMermaidModuleLoaded();
  return {
    mermaid: { name: "mermaid", type: "diagram", language: "mermaid" },
  };
});

describe("textNeedsMermaid", () => {
  it("returns false for plain text", () => {
    expect(textNeedsMermaid("hello **world**")).toBe(false);
  });

  it("returns false for non-mermaid fences", () => {
    expect(textNeedsMermaid("```js\nconsole.log(1)\n```")).toBe(false);
  });

  it("detects a fence at the start of a line", () => {
    expect(textNeedsMermaid("```mermaid\ngraph TD\n```")).toBe(true);
    expect(textNeedsMermaid("intro\n```mermaid\ngraph TD\n```")).toBe(true);
  });

  it("detects fences indented up to 3 spaces", () => {
    expect(textNeedsMermaid("   ```mermaid\ngraph TD\n```")).toBe(true);
  });

  it("rejects 4-space indentation (indented code block in markdown)", () => {
    expect(textNeedsMermaid("    ```mermaid\ngraph TD\n```")).toBe(false);
  });

  it("rejects language identifiers merely prefixed with mermaid", () => {
    expect(textNeedsMermaid("```mermaidjs\ngraph TD\n```")).toBe(false);
  });

  it("allows an info string after the language", () => {
    expect(textNeedsMermaid("```mermaid \ngraph TD\n```")).toBe(true);
  });
});

describe("useStreamdownPlugins", () => {
  it("starts undefined (plain rendering) then resolves base plugins", async () => {
    const { result } = renderHook(() => useStreamdownPlugins("hello"));

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.code).toBeDefined();
    expect(result.current?.math).toBeDefined();
    expect(result.current?.cjk).toBeDefined();
    expect(result.current?.mermaid).toBeUndefined();
  });

  it("creates the math plugin with singleDollarTextMath enabled", async () => {
    const { result } = renderHook(() => useStreamdownPlugins("$E=mc^2$"));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(vi.mocked(createMathPlugin)).toHaveBeenCalledWith({
      singleDollarTextMath: true,
    });
  });

  it("does not load the mermaid chunk for text without a mermaid fence", () => {
    expect(mockMermaidModuleLoaded).not.toHaveBeenCalled();
  });

  it("adds the mermaid plugin when the text has a mermaid fence", async () => {
    const { result } = renderHook(() =>
      useStreamdownPlugins("```mermaid\ngraph TD\n```"),
    );

    await waitFor(() => expect(result.current?.mermaid).toBeDefined());
    expect(result.current?.code).toBeDefined();
    expect(mockMermaidModuleLoaded).toHaveBeenCalledTimes(1);
  });

  it("upgrades when streaming text gains a mermaid fence", async () => {
    const { result, rerender } = renderHook(
      ({ text }) => useStreamdownPlugins(text),
      { initialProps: { text: "drawing a diagram:" } },
    );
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.mermaid).toBeUndefined();
    const baseConfig = result.current;

    rerender({ text: "drawing a diagram:\n```mermaid\ngraph TD\n```" });
    await waitFor(() => expect(result.current?.mermaid).toBeDefined());
    expect(result.current).not.toBe(baseConfig);
  });
});
