import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageItem from "./MessageItem";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

function recentIso(): string {
  return new Date(Date.now() - 10_000).toISOString();
}

function userMessage(
  text: string,
  metadata?: ChatUIMessage["metadata"],
): ChatUIMessage {
  return {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text }],
    metadata,
  };
}

function assistantMessage(
  text: string,
  metadata?: ChatUIMessage["metadata"],
): ChatUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text }],
    metadata,
  };
}

describe("MessageItem", () => {
  it("renders a user message as a muted right-aligned bubble", () => {
    render(<MessageItem message={userMessage("Hello there")} />);

    const article = screen.getByRole("article", { name: "You" });
    expect(article).toHaveClass("items-end");
    expect(article).toHaveTextContent("Hello there");
    const bubble = article.querySelector("div.bg-muted");
    expect(bubble).toHaveClass("rounded-lg");
    expect(bubble).not.toHaveClass("w-full");
  });

  it("renders an assistant message as unbubbled document markdown", () => {
    render(<MessageItem message={assistantMessage("Here is an answer")} />);

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveClass("items-start");
    expect(article).toHaveTextContent("Here is an answer");
    const body = article.querySelector("div.w-full");
    expect(body).not.toHaveClass("bg-muted");
    expect(body).not.toHaveClass("rounded-lg");
    expect(screen.queryByText("gpt-5.2")).not.toBeInTheDocument();
  });

  it("shows the assistant name header and hides the timestamp without createdAt", () => {
    render(<MessageItem message={assistantMessage("Here is an answer")} />);

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(screen.getByText("✨ Assistant")).toBeInTheDocument();
    expect(article.querySelector("time")).toBeNull();
  });

  it("orders the assistant rows: header, body, model id, copy action", () => {
    render(
      <MessageItem
        message={assistantMessage("Here is an answer", {
          modelId: "gpt-5.2",
          createdAt: recentIso(),
        })}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    const childTexts = Array.from(article.children).map(
      (child) => child.textContent ?? "",
    );
    expect(childTexts).toEqual([
      expect.stringContaining("✨ Assistant"),
      "Here is an answer",
      "gpt-5.2",
      "",
    ]);
    expect(childTexts[0]).toContain("just now");

    const time = screen.getByText("just now");
    expect(time).toHaveClass("opacity-0");
    expect(time).toHaveClass("group-hover/message:opacity-100");
  });

  it("shows the user timestamp above the bubble and copy below it", () => {
    const createdAt = recentIso();
    render(<MessageItem message={userMessage("Hello", { createdAt })} />);

    const article = screen.getByRole("article", { name: "You" });
    const children = Array.from(article.children);
    expect(children).toHaveLength(3);
    expect(children[0]?.tagName).toBe("TIME");
    expect(children[1]).toHaveClass("bg-muted");
    expect(children[2]).toHaveClass("opacity-0");

    const time = screen.getByText("just now");
    expect(time).toHaveAttribute("datetime", createdAt);
    expect(time.getAttribute("title")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("offers a labelled copy action for both roles", () => {
    const { rerender } = render(
      <MessageItem message={userMessage("Hello")} />,
    );
    expect(
      screen.getByRole("button", { name: "Copy message" }),
    ).toBeInTheDocument();

    rerender(<MessageItem message={assistantMessage("Answer")} />);
    expect(
      screen.getByRole("button", { name: "Copy message" }),
    ).toBeInTheDocument();
  });

  it("keeps stopped and failed captions under the assistant message", () => {
    const { rerender } = render(
      <MessageItem
        message={assistantMessage("Partial", { outcome: "stopped" })}
      />,
    );
    expect(screen.getByText("Stopped")).toBeInTheDocument();

    rerender(
      <MessageItem
        message={assistantMessage("Partial", {
          outcome: "failed",
          errorMessage: "model does not exist",
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("model does not exist");
  });

  it("expands thinking while streaming and auto-collapses when text arrives", () => {
    const thinking: ChatUIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "planning the steps" }],
    };
    const { rerender } = render(
      <MessageItem message={thinking} streaming />,
    );

    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("planning the steps")).toBeInTheDocument();

    rerender(
      <MessageItem
        streaming
        message={{
          ...thinking,
          parts: [
            { type: "reasoning", text: "planning the steps" },
            { type: "text", text: "Here is the answer" },
          ],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("planning the steps")).toBeInTheDocument();
    expect(screen.getByText("Here is the answer")).toBeInTheDocument();
  });

  it("lets the user reopen a collapsed thought after the turn finishes", () => {
    render(
      <MessageItem
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "planning the steps" },
            { type: "text", text: "Here is the answer" },
          ],
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Thought" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("planning the steps")).toBeInTheDocument();
  });

  it("explains when the turn finished at the token limit with no answer", () => {
    render(
      <MessageItem
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "reasoning", text: "still thinking" }],
          metadata: { finishReason: "length" },
        }}
      />,
    );

    expect(
      screen.getByText("Output stopped at the token limit."),
    ).toBeInTheDocument();
  });
});

describe("MessageItem thinking duration", () => {
  it("shows the recorded duration once thinking has finished", () => {
    render(
      <MessageItem
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "planning the steps" },
            { type: "text", text: "Here is the answer" },
          ],
          metadata: { reasoningMs: 3210 },
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Thought (3.2s)" }),
    ).toBeInTheDocument();
  });

  it("shows Thinking without a duration while still streaming", () => {
    render(
      <MessageItem
        streaming
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "reasoning", text: "planning the steps" }],
          metadata: { reasoningMs: 3210 },
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Thinking" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Thought/ }),
    ).not.toBeInTheDocument();
  });
});
