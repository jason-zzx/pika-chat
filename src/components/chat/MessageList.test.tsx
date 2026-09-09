import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageList, { type MessageListHandle } from "./MessageList";

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

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 200;
/** Mirrors the gap the list leaves above a jumped-to message. */
const JUMP_OFFSET = 16;

// jsdom implements neither Element.scrollTo nor window.matchMedia; the
// scroll-to-latest button and the chat-map jump both need them. Stubs live
// here, never in product code.
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

/** Gives the list's scroll container deterministic metrics and a scrollTop
 * that records assignments (jsdom has no layout engine). */
function mockScrollMetrics(el: HTMLElement) {
  let scrollTop = 0;
  Object.defineProperty(el, "scrollHeight", {
    value: SCROLL_HEIGHT,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    value: CLIENT_HEIGHT,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
}

function scrollContainer(): HTMLElement {
  const container = screen
    .getAllByRole("article")[0]
    ?.closest(".overflow-y-auto");
  if (!(container instanceof HTMLElement)) {
    throw new Error("scroll container not found");
  }
  return container;
}

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

describe("MessageList scroll anchors (R4)", () => {
  it("keys every row by version group, so a jump target survives a version switch", () => {
    const { rerender } = render(
      <MessageList
        messages={[
          userMessage("u1", "question"),
          assistantMessage("v1", "first version", "group-1"),
        ]}
        streaming={false}
      />,
    );

    // User rows carry no groupId and fall back to the message id.
    expect(screen.getByRole("article", { name: "You" })).toHaveAttribute(
      "data-message-key",
      "u1",
    );
    expect(screen.getByRole("article", { name: "Assistant" })).toHaveAttribute(
      "data-message-key",
      "group-1",
    );

    // A version switch swaps in a different-id row; the anchor must not move.
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
    expect(article).toHaveAttribute("data-message-key", "group-1");
  });
});

describe("MessageList scroll-to-latest button (R1)", () => {
  function renderTwo() {
    render(
      <MessageList
        messages={[
          userMessage("u1", "question"),
          assistantMessage("a1", "answer", "group-1"),
        ]}
        streaming={false}
      />,
    );
    const container = scrollContainer();
    mockScrollMetrics(container);
    return container;
  }

  it("shows the button only while the view is away from the bottom", () => {
    const container = renderTwo();
    expect(
      screen.queryByRole("button", { name: "Scroll to latest" }),
    ).not.toBeInTheDocument();

    // Scroll away from the bottom (distance 800 > 32).
    container.scrollTop = 0;
    fireEvent.scroll(container);
    expect(
      screen.getByRole("button", { name: "Scroll to latest" }),
    ).toBeInTheDocument();
  });

  it("scrolls to the bottom and re-hides the button on click", () => {
    const container = renderTwo();
    container.scrollTop = 0;
    fireEvent.scroll(container);

    fireEvent.click(screen.getByRole("button", { name: "Scroll to latest" }));

    // Clamped to the scrollable maximum (1000 - 200), which is the same
    // position the browser would land on for an unclamped scrollHeight.
    expect(container.scrollTo).toHaveBeenCalledWith({
      top: SCROLL_HEIGHT - CLIENT_HEIGHT,
      behavior: "smooth",
    });
    expect(
      screen.queryByRole("button", { name: "Scroll to latest" }),
    ).not.toBeInTheDocument();

    // Mid-flight scroll events still measure far from the bottom; the button
    // must not flash back on for the duration of the smooth scroll.
    fireEvent.scroll(container);
    expect(
      screen.queryByRole("button", { name: "Scroll to latest" }),
    ).not.toBeInTheDocument();

    // Landing hands tracking back to the measured distance.
    container.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT;
    fireEvent.scroll(container);
    expect(
      screen.queryByRole("button", { name: "Scroll to latest" }),
    ).not.toBeInTheDocument();

    container.scrollTop = 0;
    fireEvent.scroll(container);
    expect(
      screen.getByRole("button", { name: "Scroll to latest" }),
    ).toBeInTheDocument();
  });
});

describe("MessageList chat-map jump (R5)", () => {
  function renderWithRef() {
    const ref = createRef<MessageListHandle>();
    render(
      <MessageList
        ref={ref}
        messages={[
          userMessage("u1", "question"),
          assistantMessage("v1", "first answer", "group-1"),
          assistantMessage("a2", "later answer", "group-2"),
        ]}
        streaming={false}
      />,
    );
    mockScrollMetrics(scrollContainer());
    return ref;
  }

  /** jsdom has no layout: pin a row at `top` px so the jump math runs. */
  function stubTop(el: HTMLElement, top: number) {
    el.getBoundingClientRect = () =>
      ({
        top,
        y: top,
        bottom: top,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  it("scrolls the jumped-to message to the viewport top, clamped to the scroll range", () => {
    const ref = renderWithRef();
    const [first, second] = screen.getAllByRole("article", {
      name: "Assistant",
    });
    stubTop(first!, 500);
    // Beyond the scrollable maximum (800) — must clamp, not overshoot.
    stubTop(second!, 900);
    const container = scrollContainer();

    act(() => ref.current?.scrollToMessage("group-1"));
    expect(container.scrollTo).toHaveBeenLastCalledWith({
      top: 500 - JUMP_OFFSET,
      behavior: "smooth",
    });

    act(() => ref.current?.scrollToMessage("group-2"));
    expect(container.scrollTo).toHaveBeenLastCalledWith({
      top: SCROLL_HEIGHT - CLIENT_HEIGHT,
      behavior: "smooth",
    });
  });

  it("ignores a key whose message was deleted while the map was open", () => {
    const ref = renderWithRef();
    const container = scrollContainer();

    act(() => ref.current?.scrollToMessage("group-1"));
    expect(container.scrollTo).toHaveBeenCalledTimes(1);

    // No anchor matches: bail out before scrolling instead of throwing.
    expect(() =>
      act(() => ref.current?.scrollToMessage("gone")),
    ).not.toThrow();
    expect(container.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("releases the follow pin, so async growth cannot drag the view back", () => {
    // jsdom ships no ResizeObserver; capture the callback instead so the
    // follow-output behaviour can be driven directly. Stubbed before the
    // render so the list's observer effect picks this class up.
    const callbacks: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );

    try {
      const ref = renderWithRef();
      const container = scrollContainer();

      act(() => ref.current?.scrollToMessage("group-1"));
      // A mermaid diagram / image / formula settles after the jump: with the
      // pin still engaged the observer would yank the view to the bottom.
      act(() => {
        callbacks.forEach((cb) => cb());
      });
      expect(container.scrollTop).toBe(0);

      // "Back to latest" is the opposite operation: the pin comes back.
      act(() => ref.current?.scrollToBottom());
      container.scrollTop = 0;
      act(() => {
        callbacks.forEach((cb) => cb());
      });
      expect(container.scrollTop).toBe(SCROLL_HEIGHT);
    } finally {
      vi.unstubAllGlobals();
    }
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
