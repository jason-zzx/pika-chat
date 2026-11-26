import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireChat,
  noteSendStarted,
  resetChatPool,
} from "@/components/chat/chat-pool";
import { topicKeys } from "@/components/chat/use-chat-history";
import { getTopic } from "@/lib/api/topic";
import type { TopicDetail } from "@/lib/schemas/topic";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import ChatPoolBridge from "./ChatPoolBridge";

const chatControl = vi.hoisted(() => ({
  onFinish: undefined as
    | undefined
    | ((event: { isError: boolean; isAbort?: boolean }) => void),
}));

vi.mock("@ai-sdk/react", () => ({
  Chat: class FakeChat {
    status = "ready";
    constructor(options: { onFinish: typeof chatControl.onFinish }) {
      chatControl.onFinish = options.onFinish;
    }
  },
}));

vi.mock("@/lib/api/topic", () => ({
  getTopic: vi.fn(),
  waitForTopicTitle: vi.fn(),
  deleteTopicBestEffort: vi.fn(async () => undefined),
}));

const now = new Date();

const notify = vi.fn();
const setGenerating = vi.fn();

const sampleTopic: TopicDetail = {
  id: "t1",
  assistantId: "a1",
  title: "Trip plan",
  isFavorite: false,
  temporary: false,
  createdAt: now,
  updatedAt: now,
  summaryUpToMessageId: null,
  summaryUpToGroupId: null,
  summaryText: null,
};

function setup(page: { hidden: boolean; focused: boolean; cached?: boolean }) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (page.hidden ? "hidden" : "visible"),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(page.focused);
  vi.mocked(getTopic).mockResolvedValue(sampleTopic);
  const queryClient = new QueryClient();
  if (page.cached) {
    queryClient.setQueryData(topicKeys.detail(null, "t1"), sampleTopic);
  }
  const rendered = renderWithIntl(
    <QueryClientProvider client={queryClient}>
      <ChatPoolBridge />
    </QueryClientProvider>,
  );
  acquireChat("t1");
  return { queryClient, ...rendered };
}

beforeEach(() => {
  window.pikaNative = {
    serverName: "Test",
    notify,
    setGenerating,
    showServerMenu: vi.fn(),
    openServers: vi.fn(),
  };
});

afterEach(() => {
  delete window.pikaNative;
  Reflect.deleteProperty(document, "visibilityState");
  notify.mockReset();
  setGenerating.mockReset();
  vi.mocked(getTopic).mockReset();
  vi.restoreAllMocks();
  resetChatPool();
});

describe("ChatPoolBridge reply notification", () => {
  it("notifies with the topic title and path when the page is hidden", async () => {
    setup({ hidden: true, focused: false });
    chatControl.onFinish?.({ isError: false });
    await waitFor(() => expect(notify).toHaveBeenCalledWith({
      title: "Trip plan",
      body: "Reply finished",
      path: "/assistant/a1/t1",
    }));
  });

  it("notifies when the page is visible but unfocused", async () => {
    setup({ hidden: false, focused: false });
    chatControl.onFinish?.({ isError: false });
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  });

  it("uses the failure body for an errored turn", async () => {
    setup({ hidden: true, focused: false });
    chatControl.onFinish?.({ isError: true });
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ body: "Reply failed" }),
      ),
    );
  });

  it("stays silent while the page is visible and focused", () => {
    setup({ hidden: false, focused: true });
    chatControl.onFinish?.({ isError: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent for an aborted turn", () => {
    setup({ hidden: true, focused: false });
    chatControl.onFinish?.({ isError: false, isAbort: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("does nothing outside the desktop shell", () => {
    delete window.pikaNative;
    setup({ hidden: true, focused: false });
    expect(() => chatControl.onFinish?.({ isError: false })).not.toThrow();
  });

  it("uses cached topic detail without calling getTopic", () => {
    setup({ hidden: true, focused: false, cached: true });
    noteSendStarted("t1");
    expect(setGenerating).toHaveBeenLastCalledWith(true);

    chatControl.onFinish?.({ isError: false });

    expect(getTopic).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({
      title: "Trip plan",
      body: "Reply finished",
      path: "/assistant/a1/t1",
    });
    expect(setGenerating).toHaveBeenLastCalledWith(false);
    expect(notify.mock.invocationCallOrder[0]).toBeLessThan(
      setGenerating.mock.invocationCallOrder[1] ?? -1,
    );
  });

  it("releases native keep-alive on unmount", () => {
    const { unmount } = setup({ hidden: true, focused: false });
    noteSendStarted("t1");
    expect(setGenerating).toHaveBeenLastCalledWith(true);

    unmount();
    expect(setGenerating).toHaveBeenLastCalledWith(false);
  });
});
