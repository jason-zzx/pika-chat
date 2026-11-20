// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { findQuoteRanges, quoteFromSelection } from "./quote-range";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection();
  if (!selection) {
    throw new Error("no selection");
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function textOf(element: Element | null): Text {
  const node = element?.firstChild;
  if (!(node instanceof Text)) {
    throw new Error("expected a text node");
  }
  return node;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("quoteFromSelection", () => {
  it("quotes a selection inside one body with its offset in the body text", () => {
    const root = mount(
      `<article data-message-key="g1">
        <div data-reasoning>thinking</div>
        <div data-quote-body><p>alpha beta</p><p>gamma beta</p></div>
      </article>`,
    );
    const second = textOf(root.querySelectorAll("p")[1] ?? null);
    const selection = select(second, 6, second, 10);

    expect(quoteFromSelection(selection, root)).toEqual({
      messageKey: "g1",
      text: "beta",
      offset: "alpha beta".length + 6,
    });
  });

  it("ignores selections outside a body or across messages", () => {
    const root = mount(
      `<article data-message-key="g1">
        <div id="reasoning">thinking</div>
        <div data-quote-body><p id="a">first</p></div>
      </article>
      <article data-message-key="g2">
        <div data-quote-body><p id="b">second</p></div>
      </article>`,
    );
    const reasoning = textOf(root.querySelector("#reasoning"));
    expect(
      quoteFromSelection(select(reasoning, 0, reasoning, 5), root),
    ).toBeNull();
    const a = textOf(root.querySelector("#a"));
    const b = textOf(root.querySelector("#b"));
    expect(quoteFromSelection(select(a, 1, b, 2), root)).toBeNull();
  });
});

describe("findQuoteRanges", () => {
  const html = `<article data-message-key="g1">
    <div data-quote-body><p>repeat once</p><p>repeat <b>twice</b></p></div>
  </article>`;

  it("resolves a repeated phrase to the occurrence at the stored offset", () => {
    const root = mount(html);
    const article = root.querySelector("article");
    if (!article) {
      throw new Error("missing article");
    }
    const ranges = findQuoteRanges(article, {
      messageKey: "g1",
      text: "repeat\ntwice",
      offset: "repeat once".length,
    });

    expect(ranges?.map((range) => range.toString())).toEqual([
      "repeat ",
      "twice",
    ]);
    expect(ranges?.[0]?.startContainer.parentElement?.tagName).toBe("P");
    expect(ranges?.[0]?.startOffset).toBe(0);
  });

  it("falls back to a text search when the offset no longer matches", () => {
    const root = mount(html);
    const article = root.querySelector("article");
    if (!article) {
      throw new Error("missing article");
    }
    const ranges = findQuoteRanges(article, {
      messageKey: "g1",
      text: "once",
      offset: 0,
    });
    expect(ranges?.map((range) => range.toString())).toEqual(["once"]);
    expect(
      findQuoteRanges(article, { messageKey: "g1", text: "gone", offset: 0 }),
    ).toBeNull();
  });
});
