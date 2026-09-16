import { describe, expect, it } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import {
  collectCitationSources,
  transformCitationMarkers,
  type MdastNode,
} from "./citations";

describe("transformCitationMarkers", () => {
  it("splits text around [n] markers into sup-tagged nodes", () => {
    const tree: MdastNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "see [1] and [2] here" }],
        },
      ],
    };

    transformCitationMarkers(tree);

    expect(tree.children?.[0]?.children).toEqual([
      { type: "text", value: "see " },
      { type: "text", value: "[1]", data: { hName: "sup" } },
      { type: "text", value: " and " },
      { type: "text", value: "[2]", data: { hName: "sup" } },
      { type: "text", value: " here" },
    ]);
  });

  it("keeps a multi-source group [n, m] as one sup marker", () => {
    const tree: MdastNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "both [3, 5] agree" }],
        },
      ],
    };

    transformCitationMarkers(tree);

    expect(tree.children?.[0]?.children).toEqual([
      { type: "text", value: "both " },
      { type: "text", value: "[3, 5]", data: { hName: "sup" } },
      { type: "text", value: " agree" },
    ]);
  });

  it("accepts tight, ideographic-comma, and fullwidth-comma groups", () => {
    const tree: MdastNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "[1,2] [3、4] [5，6]" }],
        },
      ],
    };

    transformCitationMarkers(tree);

    expect(tree.children?.[0]?.children).toEqual([
      { type: "text", value: "[1,2]", data: { hName: "sup" } },
      { type: "text", value: " " },
      { type: "text", value: "[3、4]", data: { hName: "sup" } },
      { type: "text", value: " " },
      { type: "text", value: "[5，6]", data: { hName: "sup" } },
    ]);
  });

  it("handles adjacent markers and bracketless text", () => {
    const tree: MdastNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "[1][2]" },
            { type: "text", value: "no markers" },
          ],
        },
      ],
    };

    transformCitationMarkers(tree);

    expect(tree.children?.[0]?.children).toEqual([
      { type: "text", value: "[1]", data: { hName: "sup" } },
      { type: "text", value: "[2]", data: { hName: "sup" } },
      { type: "text", value: "no markers" },
    ]);
  });

  it("never rewrites code, inline code, or raw HTML values", () => {
    const tree: MdastNode = {
      type: "root",
      children: [
        { type: "code", value: "arr[1] = 2" },
        {
          type: "paragraph",
          children: [{ type: "inlineCode", value: "a[1]" }],
        },
        { type: "html", value: "<sup>[3]</sup>" },
      ],
    };

    transformCitationMarkers(tree);

    expect(tree.children).toEqual([
      { type: "code", value: "arr[1] = 2" },
      {
        type: "paragraph",
        children: [{ type: "inlineCode", value: "a[1]" }],
      },
      { type: "html", value: "<sup>[3]</sup>" },
    ]);
  });

  it("skips link and image subtrees so no chip nests inside an anchor", () => {
    const tree: MdastNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              children: [{ type: "text", value: "docs [1]" }],
            },
            {
              type: "linkReference",
              children: [{ type: "text", value: "ref [2]" }],
            },
            { type: "text", value: "plain [3]" },
          ],
        },
      ],
    };

    transformCitationMarkers(tree);

    expect(tree.children?.[0]?.children).toEqual([
      { type: "link", children: [{ type: "text", value: "docs [1]" }] },
      {
        type: "linkReference",
        children: [{ type: "text", value: "ref [2]" }],
      },
      { type: "text", value: "plain " },
      { type: "text", value: "[3]", data: { hName: "sup" } },
    ]);
  });
});

function searchOutputPart(output: unknown) {
  return {
    type: "tool-searchWeb" as const,
    toolCallId: "call-search",
    state: "output-available" as const,
    input: { query: "pika" },
    output,
  };
}

function searchInputPart() {
  return {
    type: "tool-searchWeb" as const,
    toolCallId: "call-search",
    state: "input-available" as const,
    input: { query: "pika" },
  };
}

function fetchPart(output: unknown) {
  return {
    type: "tool-fetchPage" as const,
    toolCallId: "call-fetch",
    state: "output-available" as const,
    input: { url: "https://a.example/page" },
    output,
  };
}

describe("collectCitationSources", () => {
  it("collects numbered sources from search and fetch parts in part order", () => {
    const parts = [
      { type: "text" as const, text: "looking it up" },
      searchOutputPart({
        provider: "tavily",
        query: "pika",
        results: [
          { title: "A", url: "https://a.example", snippet: "s", num: 1 },
          { title: "B", url: "https://b.example", snippet: "s", num: 2 },
        ],
      }),
      fetchPart({
        provider: "tavily",
        num: 3,
        url: "https://a.example/page",
        title: "Page A",
        content: "full text",
        truncated: false,
      }),
    ] satisfies ChatUIMessage["parts"];

    expect(collectCitationSources(parts)).toEqual([
      { num: 1, title: "A", url: "https://a.example", provider: "tavily" },
      { num: 2, title: "B", url: "https://b.example", provider: "tavily" },
      {
        num: 3,
        title: "Page A",
        url: "https://a.example/page",
        provider: "tavily",
      },
    ]);
  });

  it("falls back to the URL as the fetch source title", () => {
    const parts = [
      fetchPart({
        provider: "exa",
        num: 1,
        url: "https://a.example/page",
        content: "text",
        truncated: true,
      }),
    ] satisfies ChatUIMessage["parts"];

    expect(collectCitationSources(parts)).toEqual([
      {
        num: 1,
        title: "https://a.example/page",
        url: "https://a.example/page",
        provider: "exa",
      },
    ]);
  });

  it("skips error outputs, unfinished parts, and legacy results without num", () => {
    const parts = [
      searchOutputPart({
        error: "search_failed",
        attemptedProviders: ["tavily"],
      }),
      searchInputPart(),
      searchOutputPart({
        provider: "tavily",
        query: "pika",
        // Pre-R14 persisted rows: no num on results.
        results: [{ title: "Old", url: "https://old.example", snippet: "s" }],
      }),
      fetchPart({ error: "fetch_failed", attemptedProviders: ["tavily"] }),
    ] satisfies ChatUIMessage["parts"];

    expect(collectCitationSources(parts)).toBeUndefined();
  });
});
