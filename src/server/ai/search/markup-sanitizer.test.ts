import type { TextStreamPart, ToolSet } from "ai";
import { describe, expect, it } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import {
  stripMarkupFromTextParts,
  stripToolCallMarkup,
  stripToolCallMarkupTransform,
} from "./markup-sanitizer";

describe("stripToolCallMarkup", () => {
  it("removes a complete tool_call block", () => {
    const text =
      "Before.\n<tool_call>\n<function=searchWeb>\n<parameter=query>\npika\n</parameter>\n</function>\n</tool_call>\nAfter.";
    expect(stripToolCallMarkup(text)).toBe("Before.\n\nAfter.");
  });

  it("removes multiple blocks in one text", () => {
    const text = "a <tool_call>x</tool_call> b <tool_call>y</tool_call> c";
    expect(stripToolCallMarkup(text)).toBe("a  b  c");
  });

  it("removes an unterminated trailing block", () => {
    const text = "Result.\n<tool_call>\n<function=searchWeb>\n<parameter=query>";
    expect(stripToolCallMarkup(text)).toBe("Result.\n");
  });

  it("removes stray fragments outside a block", () => {
    const text =
      "a <function=searchWeb> b </function> <parameter=query> c </parameter> d </tool_call> e";
    expect(stripToolCallMarkup(text)).toBe("a  b   c  d  e");
  });

  it("removes a dangling partial tag at the very end", () => {
    expect(stripToolCallMarkup("answer <tool_ca")).toBe("answer ");
    expect(stripToolCallMarkup("answer <function=sea")).toBe("answer ");
  });

  it("collapses blank-line runs the removals leave behind", () => {
    expect(stripToolCallMarkup("a\n\n\n<tool_call>x</tool_call>\n\n\n\nb")).toBe(
      "a\n\nb",
    );
  });

  it("returns clean text unchanged, including a legit less-than", () => {
    expect(stripToolCallMarkup("a < b and c > d")).toBe("a < b and c > d");
    expect(stripToolCallMarkup("see <b>html</b> tags")).toBe(
      "see <b>html</b> tags",
    );
  });

  it("sanitizes markup-only text to empty", () => {
    expect(
      stripToolCallMarkup("<tool_call>\n<function=searchWeb>\n</tool_call>"),
    ).toBe("");
  });
});

function textBlock(
  ...deltas: string[]
): TextStreamPart<ToolSet>[] {
  return [
    { type: "text-start", id: "t1" },
    ...deltas.map(
      (text): TextStreamPart<ToolSet> => ({
        type: "text-delta",
        id: "t1",
        text,
      }),
    ),
    { type: "text-end", id: "t1" },
  ];
}

async function runTransform(
  chunks: TextStreamPart<ToolSet>[],
): Promise<TextStreamPart<ToolSet>[]> {
  const transform = stripToolCallMarkupTransform<ToolSet>()({
    tools: {},
    stopStream: () => {},
  });
  const stream = new ReadableStream<TextStreamPart<ToolSet>>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  }).pipeThrough(transform);
  const out: TextStreamPart<ToolSet>[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    out.push(value);
  }
  return out;
}

function emittedText(parts: TextStreamPart<ToolSet>[]): string {
  return parts
    .filter((part) => part.type === "text-delta")
    .map((part) => (part as { text: string }).text)
    .join("");
}

describe("stripToolCallMarkupTransform", () => {
  it("strips a complete block split across chunk boundaries", async () => {
    const out = await runTransform(
      textBlock("The answer is ", "<tool_ca", "ll>\njunk\n</tool_call>", "42."),
    );
    expect(emittedText(out)).toBe("The answer is 42.");
  });

  it("strips a fragment tag split across chunk boundaries", async () => {
    const out = await runTransform(
      textBlock("a ", "<fun", "ction=searchWeb>", " b"),
    );
    expect(emittedText(out)).toBe("a  b");
  });

  it("drops an unterminated trailing block held back to stream end", async () => {
    const out = await runTransform(
      textBlock("Result.", "<tool_call>\n<function=searchWeb>"),
    );
    expect(emittedText(out)).toBe("Result.");
  });

  it("strips mixed legit text and markup", async () => {
    const out = await runTransform(
      textBlock(
        "Here: <tool_call>x</tool_call> and a < b, then <tool_call>y</tool_call> done",
      ),
    );
    expect(emittedText(out)).toBe("Here:  and a < b, then  done");
  });

  it("strips multiple blocks in one text", async () => {
    const out = await runTransform(
      textBlock("x <tool_call>a</tool_call> y <tool_call>b</tool_call> z"),
    );
    expect(emittedText(out)).toBe("x  y  z");
  });

  it("passes clean text through unbuffered and unchanged", async () => {
    const out = await runTransform(textBlock("hello ", "world a < b"));
    expect(out).toEqual([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", text: "hello " },
      { type: "text-delta", id: "t1", text: "world a < b" },
      { type: "text-end", id: "t1" },
    ]);
  });

  it("keeps a lone trailing less-than on flush", async () => {
    const out = await runTransform(textBlock("value <"));
    expect(emittedText(out)).toBe("value <");
  });

  it("forwards non-text chunks in order after resolving the hold", async () => {
    const out = await runTransform([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", text: "ans<tool_ca" },
      { type: "text-end", id: "t1" },
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "searchWeb",
        input: { query: "q" },
      } as TextStreamPart<ToolSet>,
    ]);
    expect(out.map((part) => part.type)).toEqual([
      "text-start",
      "text-delta",
      "text-end",
      "tool-call",
    ]);
    expect(emittedText(out)).toBe("ans");
  });
});

describe("stripMarkupFromTextParts", () => {
  it("drops text parts that sanitize to nothing and keeps the rest", () => {
    const parts = [
      { type: "text", text: "<tool_call>\n<function=searchWeb>\n</tool_call>" },
      { type: "reasoning", text: "thinking" },
      {
        type: "tool-searchWeb",
        toolCallId: "c1",
        state: "output-available",
        input: { query: "q" },
        output: { provider: "tavily", query: "q", results: [] },
      },
      { type: "text", text: "real answer" },
    ] as ChatUIMessage["parts"];

    const cleaned = stripMarkupFromTextParts(parts);

    expect(cleaned).toEqual([
      { type: "reasoning", text: "thinking" },
      {
        type: "tool-searchWeb",
        toolCallId: "c1",
        state: "output-available",
        input: { query: "q" },
        output: { provider: "tavily", query: "q", results: [] },
      },
      { type: "text", text: "real answer" },
    ]);
  });

  it("keeps legit text parts untouched", () => {
    const parts = [
      { type: "text", text: "a < b, clean" },
    ] as ChatUIMessage["parts"];
    expect(stripMarkupFromTextParts(parts)).toEqual(parts);
  });
});
