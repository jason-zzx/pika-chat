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

import { AccountUserIdContext } from "@/hooks/use-account-user";
import type { GenerationSummary } from "@/lib/schemas/generation";
import {
  listPendingGenerationRequests,
  rememberPendingGenerationRequest,
} from "@/lib/pending-generation-requests";
import { listTopicMessages } from "@/lib/api/chat";
import { generationKeys } from "@/lib/api/generation";
import { chatKeys } from "./use-chat-history";
import { useComposerStore } from "@/stores/composer-store";
import { generationSummary } from "@/test-utils/generation-summary";
import { renderWithIntl, wrapWithIntl } from "@/test-utils/render-with-intl";

import ChatPoolBridge from "@/components/providers/ChatPoolBridge";

import ChatView from "./ChatView";
import { acquireChat, attachChatView, reconnectTargetFor, resetChatPool } from "./chat-pool";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

/**
 * The app tree for a route; one shared QueryClient, like the real SPA.
 * The account context is what enables the server-owned generation discovery
 * (its query keys are account-scoped), so every case renders signed in.
 */
function app(topicId: string | undefined, strict = false) {
  nav.pathname = topicId ? `/assistant/a1/${topicId}` : "/assistant/a1";
  const tree = (
    <QueryClientProvider client={queryClient}>
      <AccountUserIdContext.Provider value="account-a">
        <ChatPoolBridge />
        <ChatView assistantId="a1" topicId={topicId} />
      </AccountUserIdContext.Provider>
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

/**
 * Drains the SDK's serial job queue. With ai 7.0.170 the send request and the
 * first chunk application are chained as microtasks, so a synchronous
 * `act(() => push())` leaves them pending until something yields.
 */
async function drainStreamJobs() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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
    fail(error: Error) {
      controller.error(error);
    },
    close() {
      controller.enqueue("data: [DONE]\n\n");
      controller.close();
    },
  };
}

/**
 * Routes the network surfaces the view uses: the chat SSE stream itself, the
 * server-owned generation discovery query (which must answer with an empty
 * list, otherwise its JSON parse would consume the SSE body), the reconnect
 * GET and the receipt lookup by request id.
 */
function stubChatFetch(
  server: { stream: ReadableStream<string> },
  generations?: {
    /** Active list the discovery query sees (re-read on every refetch). */
    active?: () => GenerationSummary[];
    /** The reconnect GET: a live prefix stream, or a 204. */
    resume?: () => Response;
    /** The `?requestId=` receipt lookup. */
    lookup?: () => Response;
  },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (generations?.lookup && url.includes("requestId=")) {
        return generations.lookup();
      }
      if (generations?.resume && url.endsWith("/stream")) {
        return generations.resume();
      }
      if (url.includes("/api/chat/generations")) {
        return new Response(
          JSON.stringify({ generations: generations?.active?.() ?? [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return streamResponse(server.stream);
    }),
  );
}

function jsonGenerationStreamUrl(generationId: string): string {
  return `/api/chat/generations/${generationId}/stream`;
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

// One QueryClient is shared across cases (like the real SPA): a cached history
// from another case would seed before this case's fetch and the seed guard
// would then block it.
beforeEach(() => {
  vi.clearAllMocks();
  resetChatPool();
  queryClient.clear();
  window.sessionStorage.clear();
  useComposerStore.setState({
    pickedModel: { configId: "c1", modelId: "m1" },
    drafts: { "topic:t1": "hello", "draft:a1": "hello" },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useComposerStore.setState({ pickedModel: null, drafts: {} });
});

describe("ChatView pool resume (real AI SDK)", () => {
  it("keeps the reconnect target after the SDK runs both disconnect callbacks", async () => {
    const server = controllableStream();
    stubChatFetch(server);
    const entry = acquireChat("disconnect-topic");
    const detach = attachChatView("disconnect-topic", {
      onData: () => undefined,
      onFinish: () => undefined,
    });
    const sending = entry.chat.sendMessage({ text: "hi" });
    server.push({ type: "data-topic", data: { topicId: "disconnect-topic", streamId: "gen-disconnect" } });
    server.push({ type: "start", messageId: "answer" });
    server.push({ type: "text-start", id: "text" });
    server.push({ type: "text-delta", id: "text", delta: "partial" });
    await waitFor(() => expect(entry.chat.status).toBe("streaming"));
    server.fail(new TypeError("network connection lost"));
    await sending;
    expect(entry.chat.status).toBe("error");
    expect(reconnectTargetFor("disconnect-topic")).toBe("gen-disconnect");
    detach();
  });

  // Flipped when A's stream finishes: the server has persisted the reply by
  // then, so the history mock starts returning it.
  let aReplyPersisted = false;

  beforeEach(() => {
    aReplyPersisted = false;
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

  /**
   * Sends from the viewed topic; the server stream opens, emits the topic
   * framing and one partial token, then stays open (background stream).
   */
  async function startLiveSend(server: ReturnType<typeof controllableStream>) {
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
    await drainStreamJobs();
    expect(await screen.findByText("partial")).toBeInTheDocument();
  }

  it("shows each topic's own messages when navigating away and back around a live stream", async () => {
    const server = controllableStream();
    stubChatFetch(server);

    const view = renderWithIntl(app("t1"));
    // Topic A seeded from history.
    expect(await screen.findByText("A answer")).toBeInTheDocument();

    await startLiveSend(server);

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
    stubChatFetch(server);

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
    await startLiveSend(server);

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
    stubChatFetch(server);

    const view = renderWithIntl(app("t1"));
    expect(await screen.findByText("A answer")).toBeInTheDocument();

    await startLiveSend(server);

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
          chatKeys.history("account-a", "t1"),
        )?.messages,
      ).toHaveLength(4);
    });

    // Back to A: the finished turn is there on the FIRST return.
    view.rerender(app("t1"));
    expect(await screen.findByText("partial")).toBeInTheDocument();
    expect(screen.getByText("A answer")).toBeInTheDocument();
  });
});

describe("ChatView resumes a server-owned turn (real AI SDK)", () => {
  /** History of a topic whose answer is still being produced server-side. */
  function historyWithPlaceholder(answer: string) {
    return {
      messages: [
        storedMessage("u1", "user", "A question"),
        storedMessage("a1", "assistant", "A answer"),
        storedMessage("u2", "user", "hello"),
        storedMessage("srv-a2", "assistant", answer),
      ],
    };
  }

  function expectOrderBefore(first: string, second: string) {
    const text = document.body.textContent ?? "";
    const firstIndex = text.indexOf(first);
    const secondIndex = text.indexOf(second);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(secondIndex);
  }

  it("seeds the conversation first, then updates the resumed answer in place", async () => {
    vi.mocked(listTopicMessages).mockResolvedValue(
      historyWithPlaceholder("partial"),
    );
    const resume = controllableStream();
    stubChatFetch({ stream: new ReadableStream<string>() }, {
      active: () => [generationSummary()],
      resume: () => streamResponse(resume.stream),
    });

    renderWithIntl(app("t1"));

    // The persisted conversation is on screen before any reconnect opens...
    expect(await screen.findByText("A answer")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        jsonGenerationStreamUrl("gen-9"),
        expect.anything(),
      );
    });

    // ...and the replayed prefix lands on the placeholder's own row.
    act(() => {
      resume.push({ type: "start", messageId: "srv-a2" });
      resume.push({ type: "text-start", id: "txt-resume" });
      resume.push({ type: "text-delta", id: "txt-resume", delta: "resumed" });
    });
    await drainStreamJobs();

    expect(await screen.findByText(/resumed/)).toBeInTheDocument();
    // History was not replaced by the live turn, and the answer did not move
    // to the end of the conversation.
    expect(screen.getByText("A answer")).toBeInTheDocument();
    expectOrderBefore("A answer", "resumed");
  });

  it("retries a failed reconnect after discovery refreshes the unchanged task", async () => {
    vi.mocked(listTopicMessages).mockResolvedValue(historyWithPlaceholder("partial"));
    const generation = generationSummary();
    const resumed = controllableStream();
    const resume = vi.fn(() => {
      if (resume.mock.calls.length === 1) throw new TypeError("offline");
      return streamResponse(resumed.stream);
    });
    stubChatFetch({ stream: new ReadableStream<string>() }, {
      active: () => [generation],
      resume,
    });
    renderWithIntl(app("t1"));
    await waitFor(() => expect(acquireChat("t1").chat.status).toBe("error"), {
      timeout: 5_000,
    });
    expect(resume).toHaveBeenCalledTimes(1);
    // Step the clock past the retry rate limit. Only Date is faked: the real
    // SDK and testing-library still need real timers and microtasks.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 6_000);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: generationKeys.active("account-a") });
    });
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    act(() => {
      resumed.push({ type: "start", messageId: "srv-a2" });
      resumed.push({ type: "text-start", id: "text" });
      resumed.push({ type: "text-delta", id: "text", delta: "reconnected" });
    });
    await drainStreamJobs();
    expect(await screen.findByText("reconnected")).toBeInTheDocument();
    expect(screen.getByText("A answer")).toBeInTheDocument();
  });

  it("stops reconnecting once the server refuses the stream with 410", async () => {
    vi.mocked(listTopicMessages).mockResolvedValue(historyWithPlaceholder("partial"));
    const generation = generationSummary();
    const resume = vi.fn(() => new Response(null, { status: 410 }));
    stubChatFetch({ stream: new ReadableStream<string>() }, {
      active: () => [generation],
      resume,
    });
    renderWithIntl(app("t1"));
    await waitFor(() => expect(acquireChat("t1").chat.status).toBe("error"), {
      timeout: 5_000,
    });
    expect(resume).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 6_000);
    // Discovery still lists the task, exactly as in the retry case above.
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: generationKeys.active("account-a") });
    });
    // One macrotask lets a re-attempt reach fetch if the effect started one.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("refreshes canonical history when the reconnect answers 204", async () => {
    // Server state at mount: the turn is still listed as running and history
    // holds only the placeholder. Between discovery and the reconnect the turn
    // settles (204), and history then carries the persisted answer.
    let messages = historyWithPlaceholder("partial").messages;
    let active: GenerationSummary[] = [generationSummary()];
    vi.mocked(listTopicMessages).mockImplementation(async () => ({ messages }));
    stubChatFetch({ stream: new ReadableStream<string>() }, {
      active: () => active,
      resume: () => {
        active = [];
        messages = historyWithPlaceholder("final answer").messages;
        return new Response(null, { status: 204 });
      },
    });

    renderWithIntl(app("t1"));
    expect(await screen.findByText("A answer")).toBeInTheDocument();

    // A missed terminal chunk must not leave the view on the partial text:
    // the 204 path refetches discovery and the history reseed lands.
    expect(await screen.findByText("final answer")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("partial")).toBeNull();
    });
    expect(screen.getByText("A answer")).toBeInTheDocument();
  });
});

describe("lost confirmation recovery (reload looks the receipt up)", () => {
  it("adopts the task found by request id and retires the receipt", async () => {
    rememberPendingGenerationRequest({
      requestId: "0190a5c0-0000-7000-8000-000000000001",
      userId: "account-a",
    });
    vi.mocked(listTopicMessages).mockResolvedValue({
      messages: [
        storedMessage("u1", "user", "A question"),
        storedMessage("srv-a2", "assistant", "final answer"),
      ],
    });
    stubChatFetch({ stream: new ReadableStream<string>() }, {
      lookup: () =>
        new Response(
          JSON.stringify({
            generation: generationSummary({ status: "completed", finishedAt: new Date().toISOString() }),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const fetchMock = vi.mocked(fetch);

    renderWithIntl(app("t1"));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes("requestId="),
        ),
      ).toBe(true);
    });
    // The receipt resolved into a task: it is retired, and the topic's history
    // is refreshed so the finished answer appears.
    await waitFor(() => {
      expect(listPendingGenerationRequests("account-a")).toEqual([]);
    });
    expect(await screen.findByText("final answer")).toBeInTheDocument();
    // Recovery NEVER re-POSTs: that would be a second model call.
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST"))
      .toBe(false);
  });

  it("keeps a pending receipt when the lookup returns a server error envelope", async () => {
    const requestId = "0190a5c0-0000-7000-8000-000000000003";
    rememberPendingGenerationRequest({ requestId, userId: "account-a" });
    stubChatFetch({ stream: new ReadableStream<string>() }, {
      lookup: () => new Response(JSON.stringify({
        error: { code: "INTERNAL", messageKey: "unexpected" },
      }), { status: 500, headers: { "content-type": "application/json" } }),
    });
    const fetchMock = vi.mocked(fetch);
    renderWithIntl(app("t1"));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes("requestId="))).toBe(true));
    await drainStreamJobs();
    expect(listPendingGenerationRequests("account-a")).toEqual([
      expect.objectContaining({ requestId }),
    ]);
  });

  it("retires a receipt the server no longer knows, without re-sending", async () => {
    rememberPendingGenerationRequest({
      requestId: "0190a5c0-0000-7000-8000-000000000002",
      userId: "account-a",
    });
    vi.mocked(listTopicMessages).mockResolvedValue({
      messages: [
        storedMessage("u1", "user", "A question"),
        storedMessage("a1", "assistant", "A answer"),
      ],
    });
    stubChatFetch({ stream: new ReadableStream<string>() }, {
      lookup: () =>
        new Response(
          JSON.stringify({
            error: { code: "NOT_FOUND", messageKey: "generation.notFound" },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    });

    renderWithIntl(app("t1"));
    expect(await screen.findByText("A answer")).toBeInTheDocument();

    await waitFor(() => {
      expect(listPendingGenerationRequests("account-a")).toEqual([]);
    });
  });
});
