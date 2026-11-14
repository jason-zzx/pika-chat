import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberPendingGenerationRequest } from "@/lib/pending-generation-requests";

/**
 * The identity boundary (chat task R2/R5/§7): the QueryClient, the chat pool
 * and the pending receipts live for the whole document, so an account change
 * must destroy that document — and a loading/offline session check must NOT.
 */

const sessionState = vi.hoisted(() => ({
  current: {
    data: null as { user: { id: string } } | null,
    error: null as unknown,
    isPending: false,
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => sessionState.current },
}));

const { default: AccountProvider } = await import("./AccountProvider");
const { listPendingGenerationRequests } = await import(
  "@/lib/pending-generation-requests"
);

const locationMock = vi.hoisted(() => ({
  replace: vi.fn(),
  reload: vi.fn(),
}));

function renderBoundary(baselineUserId: string | null) {
  return render(
    <AccountProvider userId={baselineUserId}>
      <div>chat</div>
    </AccountProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, ...locationMock },
  });
  sessionState.current = { data: null, error: null, isPending: true };
});

let originalLocation: Location;

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("AccountProvider identity boundary", () => {
  // An offline/failed check is not proof of a sign-out: clearing the page
  // there would throw away a healthy session's chat state.
  it.each([
    {
      name: "the session check is still loading",
      baseline: "account-a",
      session: { data: null, error: null, isPending: true },
    },
    {
      name: "the session check fails for network reasons",
      baseline: "account-a",
      session: {
        data: { user: { id: "account-a" } },
        error: { status: 0, message: "network" },
        isPending: false,
      },
    },
    {
      name: "the account is unchanged",
      baseline: "account-a",
      session: { data: { user: { id: "account-a" } }, error: null, isPending: false },
    },
    {
      name: "the page is anonymous",
      baseline: null,
      session: { data: null, error: null, isPending: false },
    },
  ])("keeps the document when $name", ({ baseline, session }) => {
    sessionState.current = session;
    renderBoundary(baseline);
    expect(locationMock.replace).not.toHaveBeenCalled();
    expect(locationMock.reload).not.toHaveBeenCalled();
  });

  it("destroys the document when the account changed under it", () => {
    rememberPendingGenerationRequest({
      requestId: "r1",
      userId: "account-a",
    });
    sessionState.current = {
      data: { user: { id: "account-b" } },
      error: null,
      isPending: false,
    };

    act(() => {
      renderBoundary("account-a");
    });

    // Same URL, new identity: the document (query cache, pooled chats,
    // receipts) is discarded rather than seeded from account A.
    expect(locationMock.reload).toHaveBeenCalled();
    expect(locationMock.replace).not.toHaveBeenCalled();
    expect(listPendingGenerationRequests("account-a")).toEqual([]);
  });

  it.each([
    { name: "a signed-out session", error: null },
    { name: "a 401 from the session endpoint", error: { status: 401, message: "unauthorized" } },
  ])("sends $name to the sign-in page and drops receipts", ({ error }) => {
    rememberPendingGenerationRequest({
      requestId: "r1",
      userId: "account-a",
    });
    sessionState.current = { data: null, error, isPending: false };

    act(() => {
      renderBoundary("account-a");
    });

    expect(locationMock.replace).toHaveBeenCalledWith("/sign-in");
    expect(listPendingGenerationRequests("account-a")).toEqual([]);
  });
});
