/**
 * Reproduction for the pool regression: send in topic A, switch to topic B
 * mid-stream — B must show its own history, and after A finishes, both
 * topics must still render their histories (no stuck empty views).
 *
 * Unlike ChatView.test.tsx this file keeps the REAL @ai-sdk/react (real
 * Chat instances, real useChat subscriptions) and stubs only the network:
 * the bug lived in the interplay between the pool and the SDK's per-chat
 * message ownership, which the mocked hook could not capture.
 */
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listTopicMessages } from "@/lib/api/chat";
import { chatKeys } from "./use-chat-history";
import { useComposerStore } from "@/stores/composer-store";
import { renderWithIntl, wrapWithIntl } from "@/test-utils/render-with-intl";

import ChatPoolBridge from "@/components/providers/ChatPoolBridge";

import ChatView from "./ChatView";
import { resetChatPool } from "./chat-pool";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

/** The app tree for a route; one shared QueryClient, like the real SPA. */
function app(topicId: string | undefined, strict = false) {
  nav.pathname = topicId ? `/assistant/a1/${topicId}` : "/assistant/a1";
  const tree = (
    <QueryClientProvider client={queryClient}>
      <ChatPoolBridge />
      <ChatView assistantId="a1" topicId={topicId} />
    </QueryClientProvider>
  );
  return wrapWithIntl(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const nav = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => nav.searchParams,
}));

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
  // citations.ts reads the default remark plugin list at module scope.
  defaultRemarkPlugins: {},
}));

// Keep the plugin chunks (shiki/katex/mermaid) out of the test runtime.
vi.mock("./markdown-plugins", () => ({
  textNeedsMermaid: () => false,
  useStreamdownPlugins: () => undefined,
}));

const composerProps = vi.hoisted(() => ({
  latest: undefined as { onSend?: () => void } | undefined,
}));

vi.mock("./Composer", () => ({
  default: (props: { onSend?: () => void }) => {
    composerProps.latest = props;
    return null;
  },
}));

vi.mock("@/components/layout/InsetHeader", () => ({ default: () => null }));

vi.mock("@/components/assistant/use-assistants", () => ({
  assistantKeys: { tree: () => ["assistant", "tree"] },
  useAssistantTree: () => ({
    data: {
      assistants: [
        {
          id: "a1",
          name: "Helper",
          icon: null,
          topics: [
            { id: "t1", title: "Topic A" },
            { id: "t2", title: "Topic B" },
          ],
        },
      ],
    },
  }),
  useSetAssistantDefaultModel: () => ({ mutate: vi.fn() }),
  useGenerateTopicTitle: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/provider/use-available-models", () => ({
  useAvailableModels: () => ({
    data: [
      {
        configId: "c1",
        configName: "Test",
        modelId: "m1",
        displayName: "GPT-5",
        inputModalities: ["text"],
        outputModalities: ["text"],
        reasoning: false,
        reasoningOptions: [],
      },
    ],
  }),
}));

vi.mock("@/hooks/use-model-preferences", () => ({
  useModelPreferences: () => ({ data: undefined }),
}));

vi.mock("@/lib/api/chat", () => ({
  listTopicMessages: vi.fn(),
  deleteTopicMessage: vi.fn(),
  selectMessageVersion: vi.fn(),
}));

vi.mock("@/lib/api/topic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/topic")>();
  return {
    ...actual,
    getTopic: vi.fn(async (id: string) => ({
      id,
      title: id === "t1" ? "Topic A" : "Topic B",
      assistantId: "a1",
      assistant: { id: "a1", name: "Helper", icon: null },
      summaryUpToMessageId: null,
    })),
    compressTopicHistory: vi.fn(),
    updateTopicModelPreference: vi.fn(),
  };
});

vi.mock("./use-composer-attachments", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./use-composer-attachments")>();
  return {
    ...actual,
    useComposerAttachments: () => ({
      attachments: [],
      addFiles: vi.fn(),
      removeAttachment: vi.fn(),
      retryAttachment: vi.fn(),
      clearAttachments: vi.fn(),
      restoreAttachments: vi.fn(),
      stageReference: vi.fn(),
    }),
  };
});

function storedMessage(id: string, role: "user" | "assistant", text: string) {
  return {
    id,
    role,
    parts: [{ type: "text" as const, text }],
    metadata: {
      createdAt: new Date().toISOString(),
      // Carries the model pair so the composer-model seeding effect keeps
      // the store pick (c1/m1) instead of resetting it to null.
      ...(role === "assistant" ? { providerConfigId: "c1", modelId: "m1" } : {}),
    },
  };
}

/** A fetch response whose SSE body the test controls chunk by chunk. */
function controllableStream() {
  let controller: ReadableStreamDefaultController<string>;
  const stream = new ReadableStream<string>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push(chunk: object) {
      controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
    },
    close() {
      controller.enqueue("data: [DONE]\n\n");
      controller.close();
    },
  };
}

function streamResponse(body: ReadableStream<string>): Response {
  return new Response(body.pipeThrough(new TextEncoderStream()), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}


describe("ChatView pool resume (real AI SDK)", () => {
  // Flipped when A's stream finishes: the server has persisted the reply by
  // then, so the history mock starts returning it.
  let aReplyPersisted = false;

  beforeEach(() => {
    vi.clearAllMocks();
    resetChatPool();
    aReplyPersisted = false;
    useComposerStore.setState({
      pickedModel: { configId: "c1", modelId: "m1" },
      drafts: { "topic:t1": "hello", "draft:a1": "hello" },
    });
    vi.mocked(listTopicMessages).mockImplementation(async (topicId) => ({
      messages:
        topicId === "t1"
          ? [
              storedMessage("u1", "user", "A question"),
              storedMessage("a1", "assistant", "A answer"),
              ...(aReplyPersisted
                ? [
                    storedMessage("u2b", "user", "hello"),
                    storedMessage("srv-a2", "assistant", "partial"),
                  ]
                : []),
            ]
          : [
              storedMessage("u2", "user", "B question"),
              storedMessage("a2", "assistant", "B answer"),
            ],
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useComposerStore.setState({ pickedModel: null, drafts: {} });
  });

  it("shows each topic's own messages when navigating away and back around a live stream", async () => {
    const server = controllableStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse(server.stream)),
    );

    const view = renderWithIntl(app("t1"));
    // Topic A seeded from history.
    expect(await screen.findByText("A answer")).toBeInTheDocument();

    // Send in A: the server stream opens, emits the topic framing and one
    // partial token, then stays open (background stream).
    act(() => {
      composerProps.latest?.onSend?.();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => {
      server.push({ type: "start", messageId: "srv-a2" });
      server.push({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
      server.push({ type: "text-start", id: "txt1" });
      server.push({ type: "text-delta", id: "txt1", delta: "partial" });
    });
    expect(await screen.findByText("partial")).toBeInTheDocument();

    // Switch to B mid-stream: B's own history must render.
    view.rerender(app("t2"));
    expect(await screen.findByText("B answer")).toBeInTheDocument();

    // Back to A: the live stream is still there.
    view.rerender(app("t1"));
    expect(await screen.findByText("partial")).toBeInTheDocument();

    // A finishes (stream closes) while still viewed; the server persisted
    // the reply before closing, so the refetch starts returning it.
    aReplyPersisted = true;
    await act(async () => {
      server.push({ type: "text-end", id: "txt1" });
      server.push({ type: "finish", messageMetadata: undefined });
      server.close();
    });
    await waitFor(() => {
      expect(screen.queryByText("Thinking…")).toBeNull();
    });

    // To B and back to A: both must render their content, not empty views.
    view.rerender(app("t2"));
    expect(await screen.findByText("B answer")).toBeInTheDocument();

    view.rerender(app("t1"));
    expect(await screen.findByText("A answer")).toBeInTheDocument();
    // A's finished reply comes back from the persisted history too.
    expect(await screen.findByText("partial")).toBeInTheDocument();
  });

  async function runDraftRoundTrip(strict: boolean) {
    const server = controllableStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse(server.stream)),
    );

    // Start on the assistant draft and send: the topic is created
    // mid-stream (data-topic), exactly like the reported bug.
    const view = renderWithIntl(app(undefined, strict));
    // Set the model pick after mount so the composer-model seeding effect
    // (which resets the pick on a draft) has already run.
    act(() => {
      useComposerStore.setState({
        pickedModel: { configId: "c1", modelId: "m1" },
      });
    });
    act(() => {
      composerProps.latest?.onSend?.();
    });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => {
      server.push({ type: "start", messageId: "srv-a2" });
      server.push({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
      server.push({ type: "text-start", id: "txt1" });
      server.push({ type: "text-delta", id: "txt1", delta: "partial" });
    });
    expect(await screen.findByText("partial")).toBeInTheDocument();

    // The stream finishes while the (created) topic is viewed.
    aReplyPersisted = true;
    await act(async () => {
      server.push({ type: "text-end", id: "txt1" });
      server.push({ type: "finish", messageMetadata: undefined });
      server.close();
    });

    // To B, back to A: the just-finished conversation must still render.
    view.rerender(app("t2", strict));
    expect(await screen.findByText("B answer")).toBeInTheDocument();

    view.rerender(app("t1", strict));
    expect(await screen.findByText("A answer")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();

    // And again: the second round trip must not lose it either.
    view.rerender(app("t2", strict));
    expect(await screen.findByText("B answer")).toBeInTheDocument();
    view.rerender(app("t1", strict));
    expect(await screen.findByText("A answer")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
  }

  it("keeps a draft-created topic's messages across navigation after the stream finishes", async () => {
    await runDraftRoundTrip(false);
  });

  it("survives StrictMode double-effects: detach+reattach in one commit must not swap in an empty chat", async () => {
    await runDraftRoundTrip(true);
  });

  it("finishes in the background while away: returning shows the full persisted turn", async () => {
    // Regression: a finish-time invalidation on an INACTIVE history query
    // only marks it stale. Returning used to seed that stale cache (missing
    // the finished turn) and the seed guard then blocked the fresh refetch.
    const server = controllableStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse(server.stream)),
    );

    const view = renderWithIntl(app("t1"));
    expect(await screen.findByText("A answer")).toBeInTheDocument();

    act(() => {
      composerProps.latest?.onSend?.();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => {
      server.push({ type: "start", messageId: "srv-a2" });
      server.push({
        type: "data-topic",
        data: { topicId: "t1", streamId: "s1" },
      });
      server.push({ type: "text-start", id: "txt1" });
      server.push({ type: "text-delta", id: "txt1", delta: "partial" });
    });
    expect(await screen.findByText("partial")).toBeInTheDocument();

    // Leave mid-stream; the stream finishes while topic B is viewed.
    view.rerender(app("t2"));
    expect(await screen.findByText("B answer")).toBeInTheDocument();

    aReplyPersisted = true;
    await act(async () => {
      server.push({ type: "text-end", id: "txt1" });
      server.push({ type: "finish", messageMetadata: undefined });
      server.close();
    });
    // The bridge eagerly refreshes the now-inactive history query.
    await waitFor(() => {
      expect(
        queryClient.getQueryData<{ messages: unknown[] }>(
          chatKeys.history("t1"),
        )?.messages,
      ).toHaveLength(4);
    });

    // Back to A: the finished turn is there on the FIRST return.
    view.rerender(app("t1"));
    expect(await screen.findByText("partial")).toBeInTheDocument();
    expect(screen.getByText("A answer")).toBeInTheDocument();
  });
});
