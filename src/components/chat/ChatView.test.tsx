import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listTopicMessages, deleteTopicMessage } from "@/lib/api/chat";
import type {
  ChatMessagesResponse,
  ChatUIMessage,
} from "@/lib/schemas/chat";

import ChatView from "./ChatView";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

// Keep the test focused on the history/reseed plumbing.
vi.mock("./Composer", () => ({ default: () => null }));
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
        status: "ready" as const,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        setMessages,
      };
    },
  };
});

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

function renderChatView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ChatView />
    </QueryClientProvider>,
  );
  return client;
}

describe("ChatView session-created topic history (B8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
