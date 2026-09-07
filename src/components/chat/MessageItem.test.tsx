import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageItem from "./MessageItem";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

// Keep the plugin chunks (shiki/katex/mermaid) out of the test runtime.
vi.mock("./markdown-plugins", () => ({
  textNeedsMermaid: () => false,
  useStreamdownPlugins: () => undefined,
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
    const revealRow = children[2]?.querySelector("div.opacity-0");
    expect(revealRow).toHaveClass("group-hover/message:opacity-100");

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

describe("MessageItem version and action wiring", () => {
  it("shows the version switcher from assistant metadata and forwards selection", () => {
    const onSelectVersion = vi.fn();
    const message = assistantMessage("Answer", {
      versionIndex: 2,
      versionCount: 2,
      versionIds: ["v1", "v2"],
    });
    render(
      <MessageItem message={message} onSelectVersion={onSelectVersion} />,
    );

    expect(
      screen.getByRole("group", { name: "Version 2 of 2" }),
    ).toHaveTextContent("2/2");

    fireEvent.click(screen.getByRole("button", { name: "Previous version" }));
    expect(onSelectVersion).toHaveBeenCalledWith(message, "v1");
  });

  it("hides the version switcher without version metadata", () => {
    render(<MessageItem message={assistantMessage("Answer")} />);

    expect(
      screen.queryByRole("button", { name: "Next version" }),
    ).not.toBeInTheDocument();
  });

  it("forwards regenerate and delete with the message", async () => {
    const onRegenerate = vi.fn();
    const onDelete = vi.fn();
    const message = assistantMessage("Answer");
    render(
      <MessageItem
        message={message}
        onRegenerate={onRegenerate}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Regenerate response" }),
    );
    expect(onRegenerate).toHaveBeenCalledWith(message);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(message);
  });

  it("offers delete-and-regenerate only on assistant messages", async () => {
    const onDeleteRegenerate = vi.fn();
    const message = assistantMessage("Answer");
    const { rerender } = render(
      <MessageItem message={message} onDeleteRegenerate={onDeleteRegenerate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete and regenerate" }),
    );
    expect(onDeleteRegenerate).toHaveBeenCalledWith(message);

    rerender(
      <MessageItem
        message={userMessage("Hello")}
        onDeleteRegenerate={onDeleteRegenerate}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Delete and regenerate" }),
    ).not.toBeInTheDocument();
  });
});

describe("MessageItem thinking shimmer", () => {
  function contentlessAssistant(): ChatUIMessage {
    return { id: "assistant-1", role: "assistant", parts: [] };
  }

  it("shows the shimmering Thinking placeholder while a stream has no content", () => {
    render(<MessageItem streaming message={contentlessAssistant()} />);

    const shimmer = screen.getByText("Thinking…");
    expect(shimmer).toHaveClass("animate-thinking-shimmer");
    expect(shimmer).toHaveClass("motion-reduce:animate-none");
    expect(shimmer).toHaveClass("bg-clip-text");
    // B5: the sweep must be clearly visible — dim ends against a bright band.
    expect(shimmer).toHaveClass("from-muted-foreground/40");
    expect(shimmer).toHaveClass("via-foreground");
  });

  it("replaces the shimmer as soon as a text part arrives", () => {
    const { rerender } = render(
      <MessageItem streaming message={contentlessAssistant()} />,
    );
    expect(screen.getByText("Thinking…")).toBeInTheDocument();

    rerender(
      <MessageItem
        streaming
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Here is the answer" }],
        }}
      />,
    );

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.getByText("Here is the answer")).toBeInTheDocument();
  });

  it("replaces the shimmer as soon as a reasoning part arrives", () => {
    const { rerender } = render(
      <MessageItem streaming message={contentlessAssistant()} />,
    );

    rerender(
      <MessageItem
        streaming
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "reasoning", text: "planning the steps" }],
        }}
      />,
    );

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Thinking" }),
    ).toBeInTheDocument();
  });

  it("shows no placeholder for a contentless message that is not streaming", () => {
    render(<MessageItem message={contentlessAssistant()} />);

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });
});

describe("MessageItem tap-to-reveal", () => {
  it("reports taps through onReveal and renders the controlled revealed state (R9)", () => {
    const onReveal = vi.fn();
    const { rerender } = render(
      <MessageItem
        message={assistantMessage("Answer", { createdAt: recentIso() })}
        revealed={false}
        onReveal={onReveal}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveAttribute("data-revealed", "false");

    fireEvent.click(article);
    expect(onReveal).toHaveBeenCalledTimes(1);
    // Single-active semantics: the item never toggles itself off — a repeat
    // tap just reports again and the state stays where the parent put it.
    fireEvent.click(article);
    expect(onReveal).toHaveBeenCalledTimes(2);
    expect(article).toHaveAttribute("data-revealed", "false");

    rerender(
      <MessageItem
        message={assistantMessage("Answer", { createdAt: recentIso() })}
        revealed
        onReveal={onReveal}
      />,
    );
    expect(article).toHaveAttribute("data-revealed", "true");

    fireEvent.click(article);
    // Still no local hide: the row remains revealed until the parent moves
    // the single reveal slot to another message.
    expect(article).toHaveAttribute("data-revealed", "true");
  });

  it("marks the reveal rows with the data-revealed variant", () => {
    render(
      <MessageItem message={assistantMessage("Answer", { createdAt: recentIso() })} />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    const revealRows = article.querySelectorAll("div.opacity-0, time.opacity-0");
    expect(revealRows.length).toBeGreaterThan(0);
    for (const row of revealRows) {
      expect(row).toHaveClass("group-data-[revealed=true]/message:opacity-100");
      expect(row).toHaveClass("group-hover/message:opacity-100");
    }
  });

  it("renders user messages revealed when the prop is set", () => {
    const onReveal = vi.fn();
    render(<MessageItem message={userMessage("Hello")} revealed onReveal={onReveal} />);

    const article = screen.getByRole("article", { name: "You" });
    expect(article).toHaveAttribute("data-revealed", "true");

    fireEvent.click(article);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(article).toHaveAttribute("data-revealed", "true");
  });

  it("does not report a reveal when an action button is clicked", () => {
    const onReveal = vi.fn();
    render(
      <MessageItem
        message={assistantMessage("Answer")}
        revealed={false}
        onReveal={onReveal}
        onRegenerate={vi.fn()}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    // The copy button is covered by the B4 feedback test (its transient
    // feedback legitimately reveals the row); here the regenerate button
    // must not trigger the tap-to-reveal path.
    fireEvent.click(
      screen.getByRole("button", { name: "Regenerate response" }),
    );

    expect(onReveal).not.toHaveBeenCalled();
    expect(article).toHaveAttribute("data-revealed", "false");
  });

  it("does not report a reveal when the click selected text", () => {
    const getSelection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ isCollapsed: false } as Selection);
    const onReveal = vi.fn();
    render(
      <MessageItem
        message={assistantMessage("Answer")}
        revealed={false}
        onReveal={onReveal}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    fireEvent.click(article);

    expect(onReveal).not.toHaveBeenCalled();
    expect(article).toHaveAttribute("data-revealed", "false");
    getSelection.mockRestore();
  });

  it("keeps the actions row visible while the dropdown menu is open (B2)", async () => {
    render(
      <MessageItem
        message={assistantMessage("Answer")}
        onDelete={vi.fn()}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveAttribute("data-revealed", "false");

    // Opening the menu moves focus into the portaled popup; without the
    // menu-open state counting as revealed, the row would vanish here.
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(article).toHaveAttribute("data-revealed", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    await screen.findByRole("article", { name: "Assistant" });
    await vi.waitFor(() => {
      expect(
        screen.getByRole("article", { name: "Assistant" }),
      ).toHaveAttribute("data-revealed", "false");
    });
  });

  it("keeps the actions row visible for the copy feedback window, then hides it again (B4)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      render(<MessageItem message={assistantMessage("Answer")} />);

      const article = screen.getByRole("article", { name: "Assistant" });
      expect(article).toHaveAttribute("data-revealed", "false");

      fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

      // The 2s check-icon feedback must stay visible even though the pointer
      // and focus may have left the message row.
      await vi.waitFor(() => {
        expect(screen.getByTitle("Copied")).toBeInTheDocument();
      });
      expect(article).toHaveAttribute("data-revealed", "true");

      await act(async () => {
        vi.advanceTimersByTime(2_100);
      });
      expect(screen.getByTitle("Copy message")).toBeInTheDocument();
      expect(article).toHaveAttribute("data-revealed", "false");
    } finally {
      vi.useRealTimers();
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
    }
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
