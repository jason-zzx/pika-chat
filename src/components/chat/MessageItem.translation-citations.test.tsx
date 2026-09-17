import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import MessageItem from "./MessageItem";

// Real Streamdown pipeline (unlike MessageItem.test.tsx, which stubs
// Streamdown): only the heavy plugin chunks are kept out, mirroring
// Markdown.citations.test.tsx. The point of this file is the end-to-end R7
// path — a translation block's `[n]` markers must become citation chips, not
// literal text, which fails if TranslationBlock drops the `citations` prop.
vi.mock("./markdown-plugins", () => ({
  textNeedsMermaid: () => false,
  useStreamdownPlugins: () => undefined,
}));

/** Assistant message whose only `[1]` lives in the translation, so the chip
 * can only come from the translation block. */
function translatedMessage(): ChatUIMessage {
  return {
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
      { type: "text", text: "The answer without markers." },
    ],
    metadata: { translations: { "zh-CN": "答案 [1]。" } },
  };
}

describe("MessageItem translation citations (R7, real Streamdown)", () => {
  it("renders translation [n] markers as source chips, not literal text", async () => {
    const { container } = renderWithIntl(
      <MessageItem message={translatedMessage()} />,
    );

    const chip = await screen.findByRole("button", {
      name: "Source 1: pika-chat on GitHub",
    });
    expect(chip).toBeInTheDocument();
    // The marker was consumed by the citation transform — no literal `[1]`.
    expect(container.textContent).not.toContain("[1]");
  });
});
