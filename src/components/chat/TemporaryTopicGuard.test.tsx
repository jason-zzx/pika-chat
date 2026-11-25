import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireChat,
  reconnectTargetFor,
  resetChatPool,
} from "@/components/chat/chat-pool";
import { chatKeys, topicKeys } from "@/components/chat/use-chat-history";
import { AccountUserIdContext } from "@/hooks/use-account-user";
import { generationKeys } from "@/lib/api/generation";
import { localStreamingTopics, markTopicStreaming } from "@/lib/streaming-topics";
import { useComposerStore } from "@/stores/composer-store";
import { useTemporaryTopicStore } from "@/stores/temporary-topic-store";

import TemporaryTopicGuard from "./TemporaryTopicGuard";

const nav = vi.hoisted(() => ({
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

function Harness({ strict = false }: { strict?: boolean }) {
  return strict ? (
    <StrictMode>
      <TemporaryTopicGuard />
    </StrictMode>
  ) : (
    <TemporaryTopicGuard />
  );
}

function setup(options?: { pathname?: string; strict?: boolean }) {
  nav.pathname = options?.pathname ?? "/assistant/a1";
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (strict?: boolean) => (
    <QueryClientProvider client={queryClient}>
      <AccountUserIdContext.Provider value="user-1">
        <Harness strict={strict} />
      </AccountUserIdContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(options?.strict));
  return {
    queryClient,
    rerender: (nextPathname: string) => {
      nav.pathname = nextPathname;
      view.rerender(tree(options?.strict));
    },
    unmount: () => view.unmount(),
  };
}

describe("TemporaryTopicGuard", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    resetChatPool();
    useComposerStore.setState({
      drafts: {},
      attachments: {},
      quotes: {},
      imageParams: {},
    });
    useTemporaryTopicStore.setState({
      temporaryTopicId: null,
      leaveRequestCount: 0,
    });
    delete window.pikaNative;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.pikaNative;
  });

  it("survives StrictMode double-effects without deleting while staying on the draft route", () => {
    useTemporaryTopicStore.setState({ temporaryTopicId: "t-temp" });
    setup({ pathname: "/assistant/a1", strict: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useTemporaryTopicStore.getState().temporaryTopicId).toBe("t-temp");
  });

  it("deletes once and evicts pool, drafts, and caches when leaving the route", () => {
    const { queryClient, rerender } = setup({
      pathname: "/assistant/a1",
      strict: true,
    });

    // Seed client state owned by the temporary topic.
    const pooled = acquireChat("t-temp");
    pooled.generationId = "gen-1";
    markTopicStreaming("t-temp");
    useComposerStore.getState().setDraft("temp-topic:t-temp", "ephemeral");
    useComposerStore.getState().setDraft("topic:t-normal", "keep");
    queryClient.setQueryData(chatKeys.history("user-1", "t-temp"), {
      messages: [],
    });
    queryClient.setQueryData(topicKeys.detail("user-1", "t-temp"), {
      id: "t-temp",
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    act(() => {
      useTemporaryTopicStore.getState().setTemporaryTopic("t-temp");
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Navigate to settings (leaving the draft route hosting the temporary chat).
    rerender("/settings/general");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/topics/t-temp", {
      method: "DELETE",
      keepalive: false,
    });
    expect(useTemporaryTopicStore.getState().temporaryTopicId).toBeNull();
    expect(reconnectTargetFor("t-temp")).toBeNull();
    expect(localStreamingTopics().has("t-temp")).toBe(false);
    expect(useComposerStore.getState().drafts["temp-topic:t-temp"]).toBeUndefined();
    expect(useComposerStore.getState().drafts["topic:t-normal"]).toBe("keep");
    expect(
      queryClient.getQueryData(chatKeys.history("user-1", "t-temp")),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(topicKeys.detail("user-1", "t-temp")),
    ).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: generationKeys.active("user-1"),
    });
  });

  it("deletes once on same-route leave requests without affecting a later temporary chat", () => {
    setup({ pathname: "/assistant/a1", strict: true });

    act(() => {
      useTemporaryTopicStore.getState().setTemporaryTopic("t-first");
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Clicking "New topic", home logo, or header toggle keeps the same URL.
    act(() => {
      useTemporaryTopicStore.getState().requestLeaveTemporaryTopic();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/topics/t-first", {
      method: "DELETE",
      keepalive: false,
    });
    expect(useTemporaryTopicStore.getState().temporaryTopicId).toBeNull();

    // An extra leave trigger with no active topic must not poison the next chat.
    act(() => {
      useTemporaryTopicStore.getState().requestLeaveTemporaryTopic();
    });
    act(() => {
      useTemporaryTopicStore.getState().setTemporaryTopic("t-second");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useTemporaryTopicStore.getState().temporaryTopicId).toBe("t-second");
  });

  it("sends keepalive DELETE on pagehide and clears the active temporary topic", () => {
    useTemporaryTopicStore.setState({ temporaryTopicId: "t-unload" });
    setup({ pathname: "/assistant/a1" });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/topics/t-unload", {
      method: "DELETE",
      keepalive: true,
    });
    expect(useTemporaryTopicStore.getState().temporaryTopicId).toBeNull();
  });

  it("mirrors temporaryTopicId into window.pikaNative.setTemporaryTopic when present", () => {
    const setTemporaryTopic = vi.fn();
    window.pikaNative = {
      serverName: "Test",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
      setTemporaryTopic,
    };

    const { rerender } = setup({ pathname: "/assistant/a1" });
    expect(setTemporaryTopic).toHaveBeenLastCalledWith(null);

    act(() => {
      useTemporaryTopicStore.getState().setTemporaryTopic("t-native");
    });
    expect(setTemporaryTopic).toHaveBeenLastCalledWith("t-native");

    rerender("/");
    expect(setTemporaryTopic).toHaveBeenLastCalledWith(null);
  });
});
