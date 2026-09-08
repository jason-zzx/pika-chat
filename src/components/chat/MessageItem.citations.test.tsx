import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageItem from "./MessageItem";
import type { CitationSource } from "./citations";

// Capture what MessageItem passes to Markdown; render the text plainly.
const markdownCalls: Array<{
  text: string;
  citations: readonly CitationSource[] | undefined;
}> = [];
vi.mock("./Markdown", () => ({
  default: ({
    text,
    citations,
  }: {
    text: string;
    citations?: readonly CitationSource[];
  }) => {
    markdownCalls.push({ text, citations });
    return <div>{text}</div>;
  },
}));

describe("MessageItem citation wiring (R14)", () => {
  it("passes the turn's numbered sources from tool parts to Markdown", () => {
    markdownCalls.length = 0;
    const message: ChatUIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-searchWeb",
          toolCallId: "call-1",
          state: "output-available",
          input: { query: "pika chat" },
          output: {
            provider: "tavily",
            query: "pika chat",
            results: [
              {
                title: "pika-chat on GitHub",
                url: "https://github.com/example/pika-chat",
                snippet: "repo",
                num: 1,
              },
            ],
          },
        },
        {
          type: "tool-fetchPage",
          toolCallId: "call-2",
          state: "output-available",
          input: { url: "https://blog.example/release" },
          output: {
            provider: "tavily",
            num: 2,
            url: "https://blog.example/release",
            title: "Release notes",
            content: "page text",
            truncated: false,
          },
        },
        { type: "text", text: "The answer [1] builds on [2]." },
      ],
    };

    render(<MessageItem message={message} />);

    const answerCall = markdownCalls.find(
      (call) => call.text === "The answer [1] builds on [2].",
    );
    expect(answerCall?.citations).toEqual([
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
        provider: "tavily",
      },
    ]);
  });

  it("passes no citations for a message without numbered tool sources", () => {
    markdownCalls.length = 0;

    render(<MessageItem message={assistantTextOnly()} />);

    expect(markdownCalls[0]?.citations).toBeUndefined();
    expect(screen.getByText("just text")).toBeInTheDocument();
  });
});

function assistantTextOnly(): ChatUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "just text" }],
  };
}
