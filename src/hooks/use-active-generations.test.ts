import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generationKeys } from "@/lib/api/generation";
import type { GenerationsResponse } from "@/lib/schemas/generation";

import {
  ACTIVE_GENERATION_POLL_MS,
  useActiveGenerations,
} from "./use-active-generations";

/**
 * Discovery is account-owned (chat task R5/§7): the QueryClient survives route
 * changes for the whole document, so the active-generation query must be
 * keyed by account and must not run without one.
 */

// `.ts` (not `.tsx`): the jsdom project picks up hooks tests by this
// extension, so the provider tree is built with createElement.
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function stubActiveFetch(data: GenerationsResponse = { generations: [] }) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});

describe("useActiveGenerations account scoping", () => {
  it("does not fetch without a signed-in account", () => {
    const fetchMock = stubActiveFetch();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useActiveGenerations(null), {
      wrapper: wrapper(client),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keys the active list by account so one account never reads another's cache", async () => {
    const fetchMock = stubActiveFetch();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const first = renderHook(() => useActiveGenerations("account-a"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => useActiveGenerations("account-b"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    // Two separate fetches: B did not inherit A's cached (and now stale) list.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(generationKeys.active("account-a")).not.toEqual(
      generationKeys.active("account-b"),
    );
    const cached = client.getQueryData(generationKeys.active("account-a"));
    expect(cached).toEqual({ generations: [] });
  });
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
    const fetchMock = stubActiveFetch(active);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const hook = renderHook(() => useActiveGenerations("account-a"), {
      wrapper: wrapper(client),
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

  it.each([
    { userId: "account-a", enabled: false },
    { userId: null, enabled: true },
  ])("never fetches a disabled/anonymous query on visibility or polling ($userId, $enabled)", async ({ userId, enabled }) => {
    vi.useFakeTimers();
    visibility("hidden");
    const fetchMock = stubActiveFetch(active);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Even known active cached work must not bypass enabled/account guards.
    client.setQueryData(generationKeys.active(userId), active);
    const hook = renderHook(() => useActiveGenerations(userId, enabled), {
      wrapper: wrapper(client),
    });
    act(() => visibility("visible"));
    await tick(ACTIVE_GENERATION_POLL_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
    hook.unmount();
    client.clear();
  });
});
