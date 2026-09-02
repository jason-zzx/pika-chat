import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageItem from "./MessageItem";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

function userMessage(text: string): ChatUIMessage {
  return {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text }],
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
    const bubble = article.querySelector("div");
    expect(bubble).toHaveClass("bg-muted");
    expect(bubble).toHaveClass("rounded-lg");
    expect(bubble).not.toHaveClass("w-full");
  });

  it("renders an assistant message as unbubbled document markdown", () => {
    render(<MessageItem message={assistantMessage("Here is an answer")} />);

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveClass("items-start");
    expect(article).toHaveTextContent("Here is an answer");
    const body = article.querySelector("div");
    expect(body).toHaveClass("w-full");
    expect(body).not.toHaveClass("bg-muted");
    expect(body).not.toHaveClass("rounded-lg");
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
});
