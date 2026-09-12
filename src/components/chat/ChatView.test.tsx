import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listTopicMessages, deleteTopicMessage } from "@/lib/api/chat";
import type {
  ChatMessagesResponse,
  ChatUIMessage,
} from "@/lib/schemas/chat";
import {
  renderWithIntl,
  wrapWithIntl,
} from "@/test-utils/render-with-intl";

import ChatView from "./ChatView";

const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

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

const composerProps = vi.hoisted(() => ({
  latest: undefined as { showAssistantPicker?: boolean } | undefined,
}));

// Keep the test focused on the history/reseed plumbing.
vi.mock("./Composer", () => ({
  default: (props: { showAssistantPicker?: boolean }) => {
    composerProps.latest = props;
    return null;
  },
}));
vi.mock("@/components/layout/InsetHeader", () => ({ default: () => null }));

vi.mock("@/components/assistant/use-assistants", () => ({
  assistantKeys: { tree: () => ["assistant", "tree"] as const },
  useAssistantTree: () => ({ data: { assistants: [] }, isPending: false }),
  useGenerateTopicTitle: () => ({ mutate: vi.fn() }),
  useSetAssistantDefaultModel: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components/provider/use-available-models", () => ({
  useAvailableModels: () => ({ data: [] }),
}));

vi.mock("@/lib/api/chat", () => ({
  listTopicMessages: vi.fn(),
  stopChatStream: vi.fn(),
  deleteTopicMessage: vi.fn(),
  selectMessageVersion: vi.fn(),
  regenerateTopicMessage: vi.fn(),
}));

type TopicDataPart = {
  type: string;
  data: { topicId: string; streamId: string };
};

const captured = vi.hoisted(() => ({
  onData: undefined as ((part: TopicDataPart) => void) | undefined,
  setMessages: undefined as
    | Dispatch<SetStateAction<ChatUIMessage[]>>
    | undefined,
  status: "ready" as "ready" | "submitted" | "streaming",
}));

vi.mock("@ai-sdk/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useChat: (options: { onData?: (part: TopicDataPart) => void }) => {
      const [messages, setMessages] = React.useState<ChatUIMessage[]>([]);
      captured.onData = options.onData;
      captured.setMessages = setMessages;
      return {
        messages,
        status: captured.status,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        setMessages,
      };
    },
  };
});

const attachmentMocks = vi.hoisted(() => ({ addFiles: vi.fn() }));

// Composer is stubbed out above; the drop zone on the content root needs an
// observable addFiles, so the attachment hook is stubbed too.
vi.mock("./use-composer-attachments", () => ({
  useComposerAttachments: () => ({
    attachments: [],
    addFiles: attachmentMocks.addFiles,
    removeAttachment: vi.fn(),
    retryAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    restoreAttachments: vi.fn(),
  }),
}));

type StoredMessage = ChatMessagesResponse["messages"][number];

function userMessage(id: string, text: string): StoredMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
    metadata: { createdAt: new Date().toISOString() },
  };
}

function assistantVersion(
  id: string,
  text: string,
  versionIndex: number,
  versionIds: string[],
): StoredMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
    metadata: {
      groupId: "g1",
      createdAt: new Date().toISOString(),
      versionIndex,
      versionCount: versionIds.length,
      versionIds,
    },
  };
}

function renderChatView(props?: { assistantId?: string }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = renderWithIntl(
    <QueryClientProvider client={client}>
      <ChatView {...props} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

describe("ChatView session-created topic history (B8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.pathname = "/";
  });

  it("adopts the topic URL through Next's history patch by passing null state", () => {
    // Forwarding window.history.state (which carries Next's __NA marker)
    // makes Next's replaceState patch skip the router sync entirely, so the
    // New topic button becomes a same-page no-op. null keeps the patch active.
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    renderChatView({ assistantId: "a1" });

    act(() => {
      captured.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
    });

    expect(replaceSpy).toHaveBeenCalledWith(null, "", "/assistant/a1/t1");
    replaceSpy.mockRestore();
  });

  it("enables the history query for the created topic and reseeds version metadata without a refresh", async () => {
    // While the first reply is streaming, the server has nothing (or only a
    // partial view) persisted yet.
    vi.mocked(listTopicMessages).mockResolvedValue({ messages: [] });
    vi.mocked(deleteTopicMessage).mockResolvedValue(undefined);
    renderChatView();

    // Simulate the locally streamed first exchange, then the server
    // announcing the new topic id (history.replaceState would not re-render
    // the route, so the topicId prop stays undefined).
    act(() => {
      captured.setMessages?.([
        userMessage("u1", "question"),
        assistantVersion("srv-a1", "first answer", 1, ["srv-a1"]),
      ]);
    });
    act(() => {
      captured.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
    });

    // The history query is driven by the effective topic id, not the route
    // prop — it must fire for the session-created topic.
    await waitFor(() => {
      expect(listTopicMessages).toHaveBeenCalledWith("t1");
    });
    // The mid-session fetch must not clobber the live streamed messages
    // (the seed effect is pre-armed for the created topic).
    await waitFor(() => {
      expect(listTopicMessages).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("first answer")).toBeInTheDocument();

    // A message action (delete here stands in for the post-regenerate
    // reseed) resolves the server id from fresh history, then the teardown
    // reseed delivers the persisted version metadata.
    vi.mocked(listTopicMessages).mockResolvedValueOnce({
      messages: [
        userMessage("u1", "question"),
        assistantVersion("srv-a1", "first answer", 1, ["srv-a1", "srv-a2"]),
      ],
    });
    vi.mocked(listTopicMessages).mockResolvedValue({
      messages: [
        userMessage("u1", "question"),
        assistantVersion("srv-a2", "second answer", 2, ["srv-a1", "srv-a2"]),
      ],
    });

    const article = screen.getByRole("article", { name: "Assistant" });
    fireEvent.click(
      within(article).getByRole("button", { name: "More actions" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // Without the B8 fix the reseed never ran for a session-created topic
    // and the switcher only appeared after a refresh.
    expect(
      await screen.findByRole("group", { name: "Version 2 of 2" }),
    ).toHaveTextContent("2/2");
    expect(screen.getByText("second answer")).toBeInTheDocument();
  });

  it("hides the assistant picker once a session-created topic exists", async () => {
    vi.mocked(listTopicMessages).mockResolvedValue({ messages: [] });
    const view = renderChatView();
    expect(composerProps.latest?.showAssistantPicker).toBe(true);

    act(() => {
      captured.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
    });
    // The topic now belongs to a fixed assistant; the picker must go away
    // even though the route never re-rendered (replaceState only).
    expect(composerProps.latest?.showAssistantPicker).toBe(false);

    // Leaving the session-created topic resets to a fresh draft, and the
    // picker comes back.
    nav.pathname = "/assistant/a1/t1";
    view.rerender(
      wrapWithIntl(
        <QueryClientProvider client={view.client}>
          <ChatView />
        </QueryClientProvider>,
      ),
    );
    nav.pathname = "/";
    view.rerender(
      wrapWithIntl(
        <QueryClientProvider client={view.client}>
          <ChatView />
        </QueryClientProvider>,
      ),
    );
    await waitFor(() => {
      expect(composerProps.latest?.showAssistantPicker).toBe(true);
    });
  });

  it("resets to a clean draft when the URL leaves the session-created topic", async () => {
    // After history.replaceState moved the URL to the created topic, the
    // router still holds the draft route tree, so the New topic button
    // navigates without remounting this view.
    vi.mocked(listTopicMessages).mockResolvedValue({ messages: [] });
    nav.pathname = "/assistant/a1";
    const view = renderChatView({ assistantId: "a1" });

    act(() => {
      captured.setMessages?.([
        userMessage("u1", "question"),
        assistantVersion("srv-a1", "first answer", 1, ["srv-a1"]),
      ]);
    });
    act(() => {
      captured.onData?.({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
    });

    // The replaceState'd topic URL becomes visible to the router.
    nav.pathname = "/assistant/a1/t1";
    view.rerender(
      wrapWithIntl(
        <QueryClientProvider client={view.client}>
          <ChatView assistantId="a1" />
        </QueryClientProvider>,
      ),
    );
    expect(screen.getByText("first answer")).toBeInTheDocument();

    // Clicking New topic navigates to the draft URL without a remount.
    nav.pathname = "/assistant/a1";
    view.rerender(
      wrapWithIntl(
        <QueryClientProvider client={view.client}>
          <ChatView assistantId="a1" />
        </QueryClientProvider>,
      ),
    );

    await waitFor(() => {
      expect(screen.queryByText("first answer")).toBeNull();
      expect(screen.queryByText("question")).toBeNull();
    });
  });
});

describe("ChatView attachment drop zone", () => {
  beforeEach(() => {
    attachmentMocks.addFiles.mockClear();
  });

  function contentRoot(container: HTMLElement): HTMLElement {
    return container.firstElementChild as HTMLElement;
  }

  it("shows the drop overlay while files are dragged over the content area", () => {
    const { container } = renderChatView({ assistantId: "a1" });
    const root = contentRoot(container);
    expect(screen.queryByText("Release to attach files")).toBeNull();

    fireEvent.dragEnter(root, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("Release to attach files")).toBeInTheDocument();

    fireEvent.dragLeave(root, { dataTransfer: { types: ["Files"] } });
    expect(screen.queryByText("Release to attach files")).toBeNull();
  });

  it("keeps the overlay through nested enter/leave pairs from child elements", () => {
    const { container } = renderChatView({ assistantId: "a1" });
    const root = contentRoot(container);

    fireEvent.dragEnter(root, { dataTransfer: { types: ["Files"] } });
    // Crossing into a child fires another enter; leaving the child must not
    // hide the overlay while the pointer is still inside the zone.
    fireEvent.dragEnter(root, { dataTransfer: { types: ["Files"] } });
    fireEvent.dragLeave(root, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("Release to attach files")).toBeInTheDocument();

    fireEvent.dragLeave(root, { dataTransfer: { types: ["Files"] } });
    expect(screen.queryByText("Release to attach files")).toBeNull();
  });

  it("routes dropped files to the composer attachments and hides the overlay", () => {
    const { container } = renderChatView({ assistantId: "a1" });
    const root = contentRoot(container);

    fireEvent.dragEnter(root, { dataTransfer: { types: ["Files"] } });
    const file = new File(["x"], "dropped.txt", { type: "text/plain" });
    fireEvent.drop(root, {
      dataTransfer: { types: ["Files"], files: [file] },
    });

    expect(attachmentMocks.addFiles).toHaveBeenCalledWith([file]);
    expect(screen.queryByText("Release to attach files")).toBeNull();
  });

  it("ignores drags that carry no files", () => {
    const { container } = renderChatView({ assistantId: "a1" });
    const root = contentRoot(container);

    fireEvent.dragEnter(root, { dataTransfer: { types: ["text/plain"] } });
    fireEvent.drop(root, {
      dataTransfer: { types: ["text/plain"], files: [] },
    });

    expect(screen.queryByText("Release to attach files")).toBeNull();
    expect(attachmentMocks.addFiles).not.toHaveBeenCalled();
  });

  it("does not invite a drop while a turn is in flight", () => {
    captured.status = "streaming";
    try {
      const { container } = renderChatView({ assistantId: "a1" });
      const root = contentRoot(container);

      fireEvent.dragEnter(root, { dataTransfer: { types: ["Files"] } });
      expect(screen.queryByText("Release to attach files")).toBeNull();

      const file = new File(["x"], "dropped.txt", { type: "text/plain" });
      fireEvent.drop(root, {
        dataTransfer: { types: ["Files"], files: [file] },
      });
      expect(attachmentMocks.addFiles).not.toHaveBeenCalled();
    } finally {
      captured.status = "ready";
    }
  });
});
