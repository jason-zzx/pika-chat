import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageList from "./MessageList";

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

function userMessage(id: string, text: string): ChatUIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
    metadata: { createdAt: new Date().toISOString() },
  };
}

function assistantMessage(
  id: string,
  text: string,
  groupId?: string,
): ChatUIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
    metadata:
      groupId === undefined
        ? { createdAt: new Date().toISOString() }
        : { groupId, createdAt: new Date().toISOString() },
  };
}

describe("MessageList reveal state across version switches (B1)", () => {
  it("keeps the tapped-open actions row when the message id changes but the group is stable", () => {
    const { rerender } = render(
      <MessageList
        messages={[assistantMessage("v1", "first version", "group-1")]}
        streaming={false}
      />,
    );

    fireEvent.click(screen.getByRole("article", { name: "Assistant" }));
    expect(screen.getByRole("article", { name: "Assistant" })).toHaveAttribute(
      "data-revealed",
      "true",
    );

    // A version switch reseeds the list with a different-id row of the same
    // group; the item must not remount and lose the revealed state.
    rerender(
      <MessageList
        messages={[assistantMessage("v2", "second version", "group-1")]}
        streaming={false}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveTextContent("second version");
    expect(article).toHaveAttribute("data-revealed", "true");
  });

  it("does not carry reveal state over to a different group", () => {
    const { rerender } = render(
      <MessageList
        messages={[assistantMessage("v1", "first", "group-1")]}
        streaming={false}
      />,
    );
    fireEvent.click(screen.getByRole("article", { name: "Assistant" }));

    rerender(
      <MessageList
        messages={[assistantMessage("other", "other answer", "group-2")]}
        streaming={false}
      />,
    );

    expect(screen.getByRole("article", { name: "Assistant" })).toHaveAttribute(
      "data-revealed",
      "false",
    );
  });
});

describe("MessageList single-active tap reveal (R9/B7)", () => {
  function renderThree() {
    render(
      <MessageList
        messages={[
          userMessage("u1", "question one"),
          assistantMessage("a1", "answer one", "group-1"),
          assistantMessage("a2", "answer two", "group-2"),
        ]}
        streaming={false}
      />,
    );
    const [first, second] = screen.getAllByRole("article", {
      name: "Assistant",
    });
    return { first: first!, second: second! };
  }

  it("reveals a tapped message, never hides it on repeat taps, and moves the reveal to the next tapped message", () => {
    const { first, second } = renderThree();

    expect(first).toHaveAttribute("data-revealed", "false");
    expect(second).toHaveAttribute("data-revealed", "false");

    fireEvent.click(first);
    expect(first).toHaveAttribute("data-revealed", "true");

    // Tapping the same message again must NOT hide it (R9).
    fireEvent.click(first);
    expect(first).toHaveAttribute("data-revealed", "true");

    // Tapping another message moves the single reveal slot over.
    fireEvent.click(second);
    expect(first).toHaveAttribute("data-revealed", "false");
    expect(second).toHaveAttribute("data-revealed", "true");
  });

  it("reveals user messages through the same single slot", () => {
    render(
      <MessageList
        messages={[
          userMessage("u1", "question one"),
          assistantMessage("a1", "answer one", "group-1"),
        ]}
        streaming={false}
      />,
    );

    const user = screen.getByRole("article", { name: "You" });
    const assistant = screen.getByRole("article", { name: "Assistant" });

    fireEvent.click(assistant);
    expect(assistant).toHaveAttribute("data-revealed", "true");

    fireEvent.click(user);
    expect(user).toHaveAttribute("data-revealed", "true");
    expect(assistant).toHaveAttribute("data-revealed", "false");
  });

  it("keeps the reveal when the revealed message switches versions", () => {
    const { rerender } = render(
      <MessageList
        messages={[
          userMessage("u1", "question"),
          assistantMessage("v1", "first version", "group-1"),
        ]}
        streaming={false}
      />,
    );

    fireEvent.click(screen.getByRole("article", { name: "Assistant" }));
    expect(screen.getByRole("article", { name: "Assistant" })).toHaveAttribute(
      "data-revealed",
      "true",
    );

    rerender(
      <MessageList
        messages={[
          userMessage("u1", "question"),
          assistantMessage("v2", "second version", "group-1"),
        ]}
        streaming={false}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveTextContent("second version");
    expect(article).toHaveAttribute("data-revealed", "true");
  });

  it("puts the version switcher inside the reveal group instead of always showing it", () => {
    const message = assistantMessage("v1", "answer one", "group-1");
    message.metadata = {
      ...message.metadata,
      versionIndex: 1,
      versionCount: 2,
      versionIds: ["v1", "v2"],
    };
    render(
      <MessageList
        messages={[message]}
        streaming={false}
        onSelectVersion={vi.fn()}
      />,
    );

    const switcher = screen.getByRole("group", { name: "Version 1 of 2" });
    const revealRow = switcher.closest("div.opacity-0");
    expect(revealRow).not.toBeNull();
    expect(revealRow).toHaveClass("group-hover/message:opacity-100");
    expect(revealRow).toHaveClass(
      "group-data-[revealed=true]/message:opacity-100",
    );

    const article = screen.getByRole("article", { name: "Assistant" });
    expect(article).toHaveAttribute("data-revealed", "false");
    fireEvent.click(article);
    expect(article).toHaveAttribute("data-revealed", "true");
  });
});

describe("MessageList tool-part messages", () => {
  // jsdom has no layout engine and no ResizeObserver, so the pin/reserve
  // contracts from .trellis/spec/frontend/chat-scroll-behavior.md cannot be
  // exercised here — tool-block growth while bottom-pinned needs the
  // browser-level verification the spec requires. What this covers: a
  // message containing tool parts mounts through the same list code path
  // (group keys, observer setup, streaming flags) without breaking.
  function searchMessage(
    id: string,
    part: ChatUIMessage["parts"][number],
  ): ChatUIMessage {
    return {
      id,
      role: "assistant",
      parts: [
        { type: "text", text: "Let me look that up." },
        part,
        { type: "text", text: "Here is what I found." },
      ],
      metadata: { createdAt: new Date().toISOString() },
    };
  }

  it("renders a finished search tool block inside the list", () => {
    render(
      <MessageList
        messages={[
          userMessage("u1", "question"),
          searchMessage("a1", {
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
          } as ChatUIMessage["parts"][number]),
        ]}
        streaming={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Searched the web/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Here is what I found.")).toBeInTheDocument();
  });

  it("renders a running tool call on the streaming tail message", () => {
    const tail = searchMessage("a1", {
      type: "tool-searchWeb",
      toolCallId: "call-1",
      state: "input-available",
      input: { query: "pika chat" },
    } as ChatUIMessage["parts"][number]);
    tail.parts = tail.parts.slice(0, 2);

    render(
      <MessageList
        messages={[userMessage("u1", "question"), tail]}
        streaming
      />,
    );

    expect(
      screen.getByRole("button", { name: /Searching the web/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("renders a persisted interrupted tool call without spinning", () => {
    const interrupted = searchMessage("a1", {
      type: "tool-searchWeb",
      toolCallId: "call-1",
      state: "input-available",
      input: { query: "pika chat" },
    } as ChatUIMessage["parts"][number]);
    interrupted.metadata = {
      ...interrupted.metadata,
      outcome: "stopped",
    };

    render(
      <MessageList
        messages={[userMessage("u1", "question"), interrupted]}
        streaming={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Search interrupted/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

describe("MessageList regenerate placeholder shimmer (B5/R7)", () => {
  it("shows the thinking shimmer on the placeholder immediately, even mid-list", () => {
    const placeholder: ChatUIMessage = {
      id: "regen-placeholder:a1",
      role: "assistant",
      parts: [],
      metadata: { groupId: "group-1" },
    };
    render(
      <MessageList
        messages={[
          {
            id: "u1",
            role: "user",
            parts: [{ type: "text", text: "question" }],
          },
          placeholder,
          assistantMessage("a-last", "later answer", "group-2"),
        ]}
        streaming
        streamingMessageId={placeholder.id}
      />,
    );

    // The mid-list placeholder shimmers while the actual last message does
    // not, proving the placeholder is targeted by id, not position.
    expect(screen.getByText("Thinking…")).toHaveClass(
      "animate-thinking-shimmer",
    );
    expect(screen.getByText("later answer")).toBeInTheDocument();
  });
});
