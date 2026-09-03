import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ReasoningBlock from "./ReasoningBlock";

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 200;

// jsdom has no layout, so give the scroll container deterministic metrics
// and a scrollTop that actually records assignments.
function mockScrollMetrics(el: HTMLElement) {
  let scrollTop = 0;
  Object.defineProperty(el, "scrollHeight", {
    value: SCROLL_HEIGHT,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    value: CLIENT_HEIGHT,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
}

describe("ReasoningBlock auto-follow", () => {
  it("pins the scroll view to the bottom while streaming", () => {
    const { rerender } = render(
      <ReasoningBlock text="step one" streaming hasAnswer={false} />,
    );
    const container = screen.getByText("step one");
    mockScrollMetrics(container);

    rerender(
      <ReasoningBlock text="step one step two" streaming hasAnswer={false} />,
    );

    expect(container.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("stops following when the user scrolls up and resumes at the bottom", () => {
    const { rerender } = render(
      <ReasoningBlock text="step one" streaming hasAnswer={false} />,
    );
    const container = screen.getByText("step one");
    mockScrollMetrics(container);

    rerender(
      <ReasoningBlock text="step one step two" streaming hasAnswer={false} />,
    );
    expect(container.scrollTop).toBe(SCROLL_HEIGHT);

    // The user scrolls up to read; new text must not yank them back down.
    container.scrollTop = 400;
    fireEvent.scroll(container);
    rerender(
      <ReasoningBlock
        text="step one step two step three"
        streaming
        hasAnswer={false}
      />,
    );
    expect(container.scrollTop).toBe(400);

    // Scrolling back to the bottom resumes following on the next text.
    container.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT;
    fireEvent.scroll(container);
    rerender(
      <ReasoningBlock
        text="step one step two step three step four"
        streaming
        hasAnswer={false}
      />,
    );
    expect(container.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("re-pins to the latest output when the block is reopened mid-stream", () => {
    const { rerender } = render(
      <ReasoningBlock text="step one" streaming hasAnswer={false} />,
    );
    const container = screen.getByText("step one");
    mockScrollMetrics(container);
    const toggle = screen.getByRole("button", { name: "Thinking" });

    container.scrollTop = 400;
    fireEvent.scroll(container);
    fireEvent.click(toggle);
    rerender(
      <ReasoningBlock text="step one step two" streaming hasAnswer={false} />,
    );
    expect(container.scrollTop).toBe(400);

    fireEvent.click(toggle);
    expect(container.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("does not pin when the block is not streaming", () => {
    render(
      <ReasoningBlock
        text="finished thought"
        streaming={false}
        hasAnswer={true}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Thought" });
    fireEvent.click(toggle);
    const container = screen.getByText("finished thought");
    mockScrollMetrics(container);

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(container.scrollTop).toBe(0);
  });
});
