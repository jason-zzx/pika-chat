import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GenerationsResponse } from "@/lib/schemas/generation";

import {
  ACTIVE_GENERATION_POLL_MS,
  useActiveGenerations,
} from "./use-active-generations";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});

// Exercise the installed QueryClient/QueryObserver and native visibility
// listener, not mocked useQuery options or manual query.refetch calls.
const active: GenerationsResponse = {
  generations: [{
    id: "gen-a",
    topicId: "topic-a",
    assistantId: "assistant-a",
    assistantMessageId: "message-a",
    kind: "send",
    status: "running",
    targetDeleted: false,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: null,
  }],
};

function visibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  vi.spyOn(document, "hidden", "get").mockReturnValue(state === "hidden");
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

async function tick(ms = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useActiveGenerations native visibility and polling", () => {
  it("pauses hidden polling, refetches once on visibility, resumes polling and stops when idle", async () => {
    vi.useFakeTimers();
    visibility("visible");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(active), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // `.ts` (not `.tsx`): the jsdom project picks up hooks tests by this
    // extension, so the provider tree is built with createElement.
    const hook = renderHook(() => useActiveGenerations("account-a"), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    });
    await tick();
    expect(hook.result.current.data).toEqual(active);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(ACTIVE_GENERATION_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => visibility("hidden"));
    await tick(ACTIVE_GENERATION_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => visibility("visible"));
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await tick(ACTIVE_GENERATION_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ generations: [] })),
    );
    await tick(ACTIVE_GENERATION_POLL_MS);
    expect(hook.result.current.data).toEqual({ generations: [] });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await tick(ACTIVE_GENERATION_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    // An idle query still discovers work when the tab returns.
    act(() => {
      visibility("hidden");
      visibility("visible");
    });
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    hook.unmount();
    client.clear();
  });
});
