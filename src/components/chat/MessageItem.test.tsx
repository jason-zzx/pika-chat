import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import { renderWithIntl, wrapWithIntl } from "@/test-utils/render-with-intl";

import MessageItem from "./MessageItem";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
  // citations.ts reads the default remark plugin list at module scope.
  defaultRemarkPlugins: {},
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
    renderWithIntl(<MessageItem message={userMessage("Hello there")} />);

    const article = screen.getByRole("article", { name: "You" });
    expect(article).toHaveClass("items-end");
    expect(article).toHaveTextContent("Hello there");
    const bubble = article.querySelector("div.bg-muted");
    expect(bubble).toHaveClass("rounded-lg");
    expect(bubble).not.toHaveClass("w-full");
  });

  it("renders an assistant message as unbubbled document markdown", () => {
    renderWithIntl(<MessageItem message={assistantMessage("Here is an answer")} />);

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveClass("items-start");
    expect(article).toHaveTextContent("Here is an answer");
    const body = article.querySelector("div.w-full");
    expect(body).not.toHaveClass("bg-muted");
    expect(body).not.toHaveClass("rounded-lg");
    expect(screen.queryByText("gpt-5.2")).not.toBeInTheDocument();
  });

  it("shows the assistant name header and hides the timestamp without createdAt", () => {
    renderWithIntl(<MessageItem message={assistantMessage("Here is an answer")} />);

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(screen.getByText("✨ Assistant")).toBeInTheDocument();
    expect(article.querySelector("time")).toBeNull();
  });

  it("orders the assistant rows: header, body, model id, copy action", () => {
    renderWithIntl(
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
    renderWithIntl(<MessageItem message={userMessage("Hello", { createdAt })} />);

    const article = screen.getByRole("article", { name: "You" });
    const children = Array.from(article.children);
    expect(children).toHaveLength(3);
    expect(children[0]?.tagName).toBe("TIME");
    expect(children[1]).toHaveClass("bg-muted");
    const revealRow = children[2]?.querySelector("div.opacity-0");
    expect(revealRow).toHaveClass("group-hover/message:opacity-100");

    const time = screen.getByText("just now");
    expect(time).toHaveAttribute("datetime", createdAt);
    // The exact format is asserted in MessageTimestamp.test.tsx.
    expect(time).toHaveAttribute(
      "title",
      expect.stringMatching(/\d{2}:\d{2}:\d{2}/),
    );
  });

  it("offers a labelled copy action for both roles", () => {
    const { rerender } = renderWithIntl(
      <MessageItem message={userMessage("Hello")} />,
    );
    expect(
      screen.getByRole("button", { name: "Copy message" }),
    ).toBeInTheDocument();

    rerender(wrapWithIntl(<MessageItem message={assistantMessage("Answer")} />));
    expect(
      screen.getByRole("button", { name: "Copy message" }),
    ).toBeInTheDocument();
  });

  it("keeps stopped and failed captions under the assistant message", () => {
    const { rerender } = renderWithIntl(
      <MessageItem
        message={assistantMessage("Partial", { outcome: "stopped" })}
      />,
    );
    expect(screen.getByText("Stopped")).toBeInTheDocument();

    rerender(
      wrapWithIntl(
        <MessageItem
          message={assistantMessage("Partial", {
            outcome: "failed",
            errorMessage: "model does not exist",
          })}
        />,
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("model does not exist");
  });

  it("renders a JSON provider payload in the error container", () => {
    const payload = JSON.stringify(
      {
        message: "The model `foo` does not exist",
        type: "invalid_request_error",
        code: "model_not_found",
      },
      null,
      2,
    );

    renderWithIntl(
      <MessageItem
        message={assistantMessage("", {
          outcome: "failed",
          errorMessage: payload,
        })}
      />,
    );

    const alert = screen.getByRole("alert");
    // The payload arrives already formatted, and the transcript must show it
    // whole — this is the same text a reload reads back from the row.
    expect(alert.querySelector("pre")?.textContent).toBe(payload);
  });

  it("expands thinking while streaming and auto-collapses when text arrives", () => {
    const thinking: ChatUIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "planning the steps" }],
    };
    const { rerender } = renderWithIntl(
      <MessageItem message={thinking} streaming />,
    );

    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("planning the steps")).toBeInTheDocument();

    rerender(
      wrapWithIntl(
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
      ),
    );

    // The phase ended when the answer text started: it collapses and its
    // label switches to "Thought" even though the turn is still streaming.
    expect(screen.getByRole("button", { name: "Thought" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("planning the steps")).toBeInTheDocument();
    expect(screen.getByText("Here is the answer")).toBeInTheDocument();
  });

  it("lets the user reopen a collapsed thought after the turn finishes", () => {
    renderWithIntl(
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
    renderWithIntl(
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
    renderWithIntl(
      <MessageItem message={message} onSelectVersion={onSelectVersion} />,
    );

    expect(
      screen.getByRole("group", { name: "Version 2 of 2" }),
    ).toHaveTextContent("2/2");

    fireEvent.click(screen.getByRole("button", { name: "Previous version" }));
    expect(onSelectVersion).toHaveBeenCalledWith(message, "v1");
  });

  it("hides the version switcher without version metadata", () => {
    renderWithIntl(<MessageItem message={assistantMessage("Answer")} />);

    expect(
      screen.queryByRole("button", { name: "Next version" }),
    ).not.toBeInTheDocument();
  });

  it("forwards regenerate and delete with the message", async () => {
    const onRegenerate = vi.fn();
    const onDelete = vi.fn();
    const message = assistantMessage("Answer");
    renderWithIntl(
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
    const { rerender } = renderWithIntl(
      <MessageItem message={message} onDeleteRegenerate={onDeleteRegenerate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete and regenerate" }),
    );
    expect(onDeleteRegenerate).toHaveBeenCalledWith(message);

    rerender(
      wrapWithIntl(
        <MessageItem
          message={userMessage("Hello")}
          onDeleteRegenerate={onDeleteRegenerate}
          onDelete={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Delete and regenerate" }),
    ).not.toBeInTheDocument();
  });

  it("withholds delete and regenerate entries inside the compressed region", async () => {
    const message = assistantMessage("Answer");
    renderWithIntl(
      <MessageItem
        message={message}
        compressedLocked
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
        onDeleteRegenerate={vi.fn()}
      />,
    );

    // No standalone regenerate entry.
    expect(
      screen.queryByRole("button", { name: "Regenerate response" }),
    ).not.toBeInTheDocument();
    // The menu stays available for copy / translate, but not for the locked
    // operations.
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Regenerate" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Delete" }),
    ).not.toBeInTheDocument();
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
    renderWithIntl(<MessageItem streaming message={contentlessAssistant()} />);

    const shimmer = screen.getByText("Thinking…");
    expect(shimmer).toHaveClass("animate-thinking-shimmer");
    expect(shimmer).toHaveClass("motion-reduce:animate-none");
    expect(shimmer).toHaveClass("bg-clip-text");
    // B5: the sweep must be clearly visible — dim ends against a bright band.
    expect(shimmer).toHaveClass("from-muted-foreground/40");
    expect(shimmer).toHaveClass("via-foreground");
  });

  it("replaces the shimmer as soon as a text part arrives", () => {
    const { rerender } = renderWithIntl(
      <MessageItem streaming message={contentlessAssistant()} />,
    );
    expect(screen.getByText("Thinking…")).toBeInTheDocument();

    rerender(
      wrapWithIntl(
        <MessageItem
          streaming
          message={{
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "Here is the answer" }],
          }}
        />,
      ),
    );

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.getByText("Here is the answer")).toBeInTheDocument();
  });

  it("replaces the shimmer as soon as a reasoning part arrives", () => {
    const { rerender } = renderWithIntl(
      <MessageItem streaming message={contentlessAssistant()} />,
    );

    rerender(
      wrapWithIntl(
        <MessageItem
          streaming
          message={{
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "reasoning", text: "planning the steps" }],
          }}
        />,
      ),
    );

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Thinking" }),
    ).toBeInTheDocument();
  });

  it("shows no placeholder for a contentless message that is not streaming", () => {
    renderWithIntl(<MessageItem message={contentlessAssistant()} />);

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });
});

describe("MessageItem tap-to-reveal", () => {
  it("reports taps through onReveal and renders the controlled revealed state (R9)", () => {
    const onReveal = vi.fn();
    const { rerender } = renderWithIntl(
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
      wrapWithIntl(
        <MessageItem
          message={assistantMessage("Answer", { createdAt: recentIso() })}
          revealed
          onReveal={onReveal}
        />,
      ),
    );
    expect(article).toHaveAttribute("data-revealed", "true");

    fireEvent.click(article);
    // Still no local hide: the row remains revealed until the parent moves
    // the single reveal slot to another message.
    expect(article).toHaveAttribute("data-revealed", "true");
  });

  it("marks the reveal rows with the data-revealed variant", () => {
    renderWithIntl(
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
    renderWithIntl(<MessageItem message={userMessage("Hello")} revealed onReveal={onReveal} />);

    const article = screen.getByRole("article", { name: "You" });
    expect(article).toHaveAttribute("data-revealed", "true");

    fireEvent.click(article);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(article).toHaveAttribute("data-revealed", "true");
  });

  it("does not report a reveal when an action button is clicked", () => {
    const onReveal = vi.fn();
    renderWithIntl(
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
    renderWithIntl(
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
    renderWithIntl(
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
      renderWithIntl(<MessageItem message={assistantMessage("Answer")} />);

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

describe("MessageItem tool parts", () => {
  function searchMessage(): ChatUIMessage {
    return {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Let me look that up." },
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
              },
            ],
          },
        },
        { type: "text", text: "Here is what I found." },
      ],
    };
  }

  it("renders parts interleaved in part order", () => {
    renderWithIntl(<MessageItem message={searchMessage()} />);

    const article = screen.getByRole("article", { name: "Assistant" });
    const before = screen.getByText("Let me look that up.");
    const toolHeader = screen.getByRole("button", {
      name: /Searched the web/,
    });
    const after = screen.getByText("Here is what I found.");

    expect(article).toContainElement(before);
    expect(article).toContainElement(toolHeader);
    expect(article).toContainElement(after);
    expect(
      before.compareDocumentPosition(toolHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toolHeader.compareDocumentPosition(after) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Finished tool blocks load collapsed; expanding shows the sources.
    expect(toolHeader).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toolHeader);
    expect(
      screen.getByRole("link", { name: /pika-chat on GitHub/ }),
    ).toHaveAttribute("href", "https://github.com/example/pika-chat");
  });

  it("suppresses the thinking shimmer while a search tool call is running", () => {
    renderWithIntl(
      <MessageItem
        streaming
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-searchWeb",
              toolCallId: "call-1",
              state: "input-available",
              input: { query: "pika chat" },
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Searching the web/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the thinking shimmer while waiting for the step after a tool result (R8)", () => {
    renderWithIntl(
      <MessageItem
        streaming
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-searchWeb",
              toolCallId: "call-1",
              state: "output-available",
              input: { query: "pika chat" },
              output: { provider: "tavily", query: "pika chat", results: [] },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("hides the post-tool shimmer as soon as the next reasoning or text starts (R8)", () => {
    const toolPart = {
      type: "tool-searchWeb" as const,
      toolCallId: "call-1",
      state: "output-available" as const,
      input: { query: "pika chat" },
      output: { provider: "tavily" as const, query: "pika chat", results: [] },
    };
    const { rerender } = renderWithIntl(
      <MessageItem
        streaming
        message={{ id: "assistant-1", role: "assistant", parts: [toolPart] }}
      />,
    );
    expect(screen.getByText("Thinking…")).toBeInTheDocument();

    rerender(
      wrapWithIntl(
        <MessageItem
          streaming
          message={{
            id: "assistant-1",
            role: "assistant",
            parts: [toolPart, { type: "reasoning", text: "next step" }],
          }}
        />,
      ),
    );
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();

    rerender(
      wrapWithIntl(
        <MessageItem
          streaming
          message={{
            id: "assistant-1",
            role: "assistant",
            parts: [toolPart, { type: "text", text: "answering" }],
          }}
        />,
      ),
    );
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });

  it("shows no post-tool shimmer once the stream has ended (R8)", () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-searchWeb",
              toolCallId: "call-1",
              state: "output-available",
              input: { query: "pika chat" },
              output: { provider: "tavily", query: "pika chat", results: [] },
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });

  it("renders a fetchPage tool block interleaved in part order (R12)", () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "text", text: "Reading that page." },
            {
              type: "tool-fetchPage",
              toolCallId: "call-1",
              state: "output-available",
              input: { url: "https://pika.example.com/docs" },
              output: {
                provider: "exa",
                url: "https://pika.example.com/docs",
                title: "pika docs",
                content: "Full documentation text.",
                truncated: false,
              },
            },
            { type: "text", text: "Here is the summary." },
          ],
        }}
      />,
    );

    const before = screen.getByText("Reading that page.");
    const toolHeader = screen.getByRole("button", {
      name: "Toggle page fetch details",
    });
    const after = screen.getByText("Here is the summary.");

    expect(toolHeader).toHaveAttribute("aria-expanded", "false");
    expect(
      before.compareDocumentPosition(toolHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toolHeader.compareDocumentPosition(after) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "pika docs" }),
    ).toBeInTheDocument();
  });

  it("shows the thinking shimmer after a finished fetchPage call while streaming (R8)", () => {
    renderWithIntl(
      <MessageItem
        streaming
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-fetchPage",
              toolCallId: "call-1",
              state: "output-available",
              input: { url: "https://pika.example.com/docs" },
              output: {
                provider: "tavily",
                url: "https://pika.example.com/docs",
                content: "text",
                truncated: false,
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("suppresses the thinking shimmer while a fetchPage call is running", () => {
    renderWithIntl(
      <MessageItem
        streaming
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-fetchPage",
              toolCallId: "call-1",
              state: "input-available",
              input: { url: "https://pika.example.com/docs" },
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle page fetch details" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

describe("MessageItem thinking duration", () => {
  it("shows the recorded duration once thinking has finished", () => {
    renderWithIntl(
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
    renderWithIntl(
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

  it("shows each reasoning phase its own duration from live metadata (R6)", () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "first thought" },
            {
              type: "tool-searchWeb",
              toolCallId: "call-1",
              state: "output-available",
              input: { query: "pika chat" },
              output: { provider: "tavily", query: "pika chat", results: [] },
            },
            { type: "reasoning", text: "second thought" },
            { type: "text", text: "Here is the answer" },
          ],
          metadata: { reasoningDurations: [2000, 900] },
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Thought (2.0s)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Thought (0.9s)" }),
    ).toBeInTheDocument();
  });

  it("collapses a finished phase to its own duration while the next step still streams (R6)", () => {
    renderWithIntl(
      <MessageItem
        streaming
        message={{
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "first thought" },
            {
              type: "tool-searchWeb",
              toolCallId: "call-1",
              state: "output-available",
              input: { query: "pika chat" },
              output: { provider: "tavily", query: "pika chat", results: [] },
            },
            { type: "reasoning", text: "second thought" },
          ],
          metadata: { reasoningDurations: [2000] },
        }}
      />,
    );

    // The first phase ended: collapsed, labelled with its own duration even
    // though the turn is still streaming.
    const first = screen.getByRole("button", { name: "Thought (2.0s)" });
    expect(first).toHaveAttribute("aria-expanded", "false");
    // The second phase is the active one: open and still "Thinking".
    const second = screen.getByRole("button", { name: "Thinking" });
    expect(second).toHaveAttribute("aria-expanded", "true");
  });

  it("reads per-phase durations from persisted reasoning parts on reload (R6)", () => {
    // Discriminators pinned with `as const` so the hoisted literals stay
    // narrow enough for the UIMessage part union (a plain array would widen
    // `type` to string); durationMs lives in the stored-part schema, outside
    // the SDK's part type, and is carried through structurally.
    const parts = [
      { type: "reasoning" as const, text: "first thought", durationMs: 2000 },
      {
        type: "tool-searchWeb" as const,
        toolCallId: "call-1",
        state: "output-available" as const,
        input: { query: "pika chat" },
        output: { provider: "tavily" as const, query: "pika chat", results: [] },
      },
      { type: "reasoning" as const, text: "second thought", durationMs: 900 },
      { type: "text" as const, text: "Here is the answer" },
    ];
    renderWithIntl(
      <MessageItem
        message={{ id: "assistant-1", role: "assistant", parts }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Thought (2.0s)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Thought (0.9s)" }),
    ).toBeInTheDocument();
  });

  it("renders its chrome from the zh-CN catalog", () => {
    renderWithIntl(
      <MessageItem
        message={assistantMessage("Partial", { outcome: "stopped" })}
      />,
      { locale: "zh-CN" },
    );

    expect(
      screen.getByRole("article", { name: "助手" }),
    ).toBeInTheDocument();
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制消息" }),
    ).toBeInTheDocument();
  });
});

describe("MessageItem attachments", () => {
  it("renders a generated image inline on an assistant message", () => {
    // Declared as a variable so the stored-only `sizeBytes` field is carried
    // structurally (excess-property checks skip non-fresh objects).
    const parts = [
      {
        type: "file" as const,
        url: "/api/files/gen-1",
        mediaType: "image/png",
        filename: "generated.png",
        sizeBytes: 2048,
      },
      { type: "text" as const, text: "here you go" },
    ];
    renderWithIntl(
      <MessageItem
        message={{ id: "assistant-1", role: "assistant", parts }}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    const image = screen.getByRole("img", { name: "generated.png" });
    expect(article).toContainElement(image);
    expect(image).toHaveAttribute("src", "/api/files/gen-1");
    // Same rendering contract as user attachments: frame on the img itself.
    expect(image.className).toContain("rounded-lg");
    expect(image.className).toContain("border");
    expect(screen.getByText("here you go")).toBeInTheDocument();
  });

  it("renders a file card linking to the canonical attachment url", () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "user-1",
          role: "user",
          parts: [
            {
              type: "file",
              url: "/api/files/f1",
              mediaType: "application/pdf",
              filename: "report.pdf",
            },
            { type: "text", text: "see attached" },
          ],
        }}
      />,
    );

    const link = screen.getByRole("link", { name: "report.pdf" });
    expect(link).toHaveAttribute("href", "/api/files/f1");
    // Opens in a new tab; no hover gate, the tap is the interaction.
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("see attached")).toBeInTheDocument();
  });

  it("renders the attachment size when the part carries one", () => {
    // Declared as a variable so the stored-only `sizeBytes` field is carried
    // structurally (excess-property checks skip non-fresh objects), mirroring
    // the reasoning `durationMs` pattern above.
    const parts = [
      {
        type: "file" as const,
        url: "/api/files/f1",
        mediaType: "text/plain",
        filename: "notes.txt",
        sizeBytes: 1536,
      },
    ];
    renderWithIntl(
      <MessageItem message={{ id: "user-1", role: "user", parts }} />,
    );

    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
  });

  it("renders an image thumbnail for an image attachment", () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "user-1",
          role: "user",
          parts: [
            {
              type: "file",
              url: "/api/files/img-1",
              mediaType: "image/png",
              filename: "cat.png",
            },
          ],
        }}
      />,
    );

    const image = screen.getByRole("img", { name: "cat.png" });
    expect(image).toHaveAttribute("src", "/api/files/img-1");
    // Click opens the in-page preview dialog instead of navigating away.
    const button = image.closest("button");
    expect(button).not.toBeNull();
    // The frame is drawn on the img itself so it hugs the rendered size; a
    // bordered wrapper cannot track an image capped by both max-w and max-h
    // and leaves a blank gap beside it.
    expect(button?.className).toContain("inline-block");
    expect(image.className).toContain("border");
    expect(image.className).toContain("rounded-lg");
    expect(image.className).not.toContain("object-cover");
  });

  it("opens the image preview dialog when the thumbnail is clicked", async () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "user-1",
          role: "user",
          parts: [
            {
              type: "file",
              url: "/api/files/img-1",
              mediaType: "image/png",
              filename: "cat.png",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("img", { name: "cat.png" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // The dialog renders its own full-size img with the same source.
    const previews = within(dialog).getAllByRole("img", { name: "cat.png" });
    expect(previews[0]).toHaveAttribute("src", "/api/files/img-1");
  });

  it("shrinks the image button to the rendered image width on load", () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "user-1",
          role: "user",
          parts: [
            {
              type: "file",
              url: "/api/files/img-1",
              mediaType: "image/png",
              filename: "cat.png",
            },
          ],
        }}
      />,
    );

    const image = screen.getByRole("img", { name: "cat.png" });
    // jsdom never loads images: fake the intrinsic/rendered size and fire the
    // load event the ref callback listens for.
    Object.defineProperty(image, "naturalWidth", { value: 1200 });
    Object.defineProperty(image, "offsetWidth", { value: 256 });
    fireEvent.load(image);

    const button = image.closest("button");
    expect(button?.style.width).toBe("256px");
  });

  it("renders an attachment-only message without a text bubble", () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "user-1",
          role: "user",
          parts: [
            {
              type: "file",
              url: "/api/files/f1",
              mediaType: "text/plain",
              filename: "notes.txt",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "notes.txt" })).toBeInTheDocument();
    // No empty muted bubble is rendered when the message carries no text.
    expect(document.querySelector("div.bg-muted p")).toBeNull();
  });

  it("renders audio as a native player plus the name card", () => {
    const parts = [
      {
        type: "file" as const,
        url: "/api/files/a1",
        mediaType: "audio/mpeg",
        filename: "clip.mp3",
        sizeBytes: 15_360,
      },
    ];
    renderWithIntl(
      <MessageItem message={{ id: "user-1", role: "user", parts }} />,
    );

    const audio = document.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute("src", "/api/files/a1");
    // Native controls are the tap path — no hover anywhere in this card.
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("preload", "none");
    expect(audio).toHaveAttribute(
      "aria-label",
      "Audio player for clip.mp3",
    );
    // The name card's accessible name folds in the size, so match the prefix.
    expect(screen.getByRole("link", { name: /clip\.mp3/ })).toHaveAttribute(
      "href",
      "/api/files/a1",
    );
    expect(screen.getByText("15 KB")).toBeInTheDocument();
  });

  it("renders video as a native player", () => {
    renderWithIntl(
      <MessageItem
        message={{
          id: "user-1",
          role: "user",
          parts: [
            {
              type: "file",
              url: "/api/files/v1",
              mediaType: "video/mp4",
              filename: "clip.mp4",
            },
          ],
        }}
      />,
    );

    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "/api/files/v1");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("aria-label", "Video player for clip.mp4");
  });

  it("does not report a reveal when the media controls are tapped", () => {
    const onReveal = vi.fn();
    renderWithIntl(
      <MessageItem
        message={{
          id: "user-1",
          role: "user",
          parts: [
            {
              type: "file",
              url: "/api/files/a1",
              mediaType: "audio/mpeg",
              filename: "clip.mp3",
            },
          ],
        }}
        onReveal={onReveal}
      />,
    );

    const audio = document.querySelector("audio");
    if (!audio) {
      throw new Error("expected an audio player");
    }
    fireEvent.click(audio);
    expect(onReveal).not.toHaveBeenCalled();
  });
});

describe("MessageItem translations", () => {
  it("renders persisted translation blocks with native language tags (assistant)", () => {
    renderWithIntl(
      <MessageItem
        message={assistantMessage("Hello **world**", {
          translations: { "zh-CN": "你好**世界**", ja: "こんにちは" },
        })}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveTextContent("简体中文");
    expect(article).toHaveTextContent("你好**世界**");
    expect(article).toHaveTextContent("日本語");
    expect(article).toHaveTextContent("こんにちは");
  });

  it("renders translation blocks for user messages", () => {
    renderWithIntl(
      <MessageItem
        message={userMessage("你好", {
          translations: { en: "Hello" },
        })}
      />,
    );

    const article = screen.getByRole("article", { name: "You" });
    expect(article).toHaveTextContent("English");
    expect(article).toHaveTextContent("Hello");
  });

  it("renders no translation block when translations are absent or empty", () => {
    const { rerender } = renderWithIntl(
      <MessageItem message={assistantMessage("Hello")} />,
    );
    expect(screen.queryByText("English")).not.toBeInTheDocument();

    rerender(
      wrapWithIntl(
        <MessageItem
          message={assistantMessage("Hello", { translations: {} })}
        />,
      ),
    );
    expect(screen.queryByText("English")).not.toBeInTheDocument();
  });

  it("passes the translate action through with the message and language", async () => {
    const onTranslate = vi.fn();
    renderWithIntl(
      <MessageItem
        message={assistantMessage("Hello")}
        onTranslate={onTranslate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "日本語" }),
    );
    expect(onTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "assistant-1" }),
      "ja",
    );
  });

  it("collapses and re-expands a translation block, hiding its body (R6)", () => {
    renderWithIntl(
      <MessageItem
        message={assistantMessage("Hello", {
          translations: { "zh-CN": "你好**世界**" },
        })}
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Hide the 简体中文 translation",
    });
    // Expanded by default: language tag and body both visible.
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("简体中文")).toBeInTheDocument();
    expect(screen.getByText("你好**世界**")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const content = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    // Collapsed: the body container is grid-rows-[0fr] and taken out of the
    // a11y tree; the language tag stays in the header.
    expect(content).toHaveClass("grid-rows-[0fr]");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("简体中文")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(content).toHaveClass("grid-rows-[1fr]");
  });

  it("keeps each language's collapse state independent (R6)", () => {
    renderWithIntl(
      <MessageItem
        message={assistantMessage("Hello", {
          translations: { "zh-CN": "你好", ja: "こんにちは" },
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Hide the 简体中文 translation" }),
    );

    expect(
      screen.getByRole("button", { name: "Show the 简体中文 translation" }),
    ).toHaveAttribute("aria-expanded", "false");
    // The other language is untouched.
    expect(
      screen.getByRole("button", { name: "Hide the 日本語 translation" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

describe("MessageItem translation progress", () => {
  it("shows the shimmering pending placeholder while a translation is in flight (R5)", () => {
    renderWithIntl(
      <MessageItem
        message={assistantMessage("Hello")}
        translatingTargetLang="ja"
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Translating to 日本語");
    const shimmer = status.querySelector("span");
    expect(shimmer).toHaveClass("animate-thinking-shimmer");
    expect(shimmer).toHaveClass("motion-reduce:animate-none");
  });

  it("renders the pending placeholder for user messages too (R5)", () => {
    renderWithIntl(
      <MessageItem message={userMessage("你好")} translatingTargetLang="en" />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Translating to English",
    );
  });

  it("keeps the pending placeholder alongside existing translations (R5)", () => {
    renderWithIntl(
      <MessageItem
        message={assistantMessage("Hello", {
          translations: { "zh-CN": "你好" },
        })}
        translatingTargetLang="ja"
      />,
    );

    expect(screen.getByText("简体中文")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Translating to 日本語",
    );
  });

  it("drops the placeholder once the translation lands (R5)", () => {
    const { rerender } = renderWithIntl(
      <MessageItem
        message={assistantMessage("Hello")}
        translatingTargetLang="ja"
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(
      wrapWithIntl(
        <MessageItem
          message={assistantMessage("Hello", {
            translations: { ja: "こんにちは" },
          })}
        />,
      ),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("こんにちは")).toBeInTheDocument();
  });
});
