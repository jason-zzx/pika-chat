import { beforeEach, describe, expect, it } from "vitest";

// Lives in the jsdom project because the store is sessionStorage-backed.
import {
  clearPendingGenerationRequests,
  forgetPendingGenerationRequest,
  listPendingGenerationRequests,
  rememberPendingGenerationRequest,
} from "@/lib/pending-generation-requests";

/**
 * Pending receive ids are the client half of the lost-confirmation recovery
 * (chat task §4/G2): one bucket per account, ids only (never prompts), dropped
 * on sign-out so account B can never inherit account A's lookups.
 */

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("pending generation request receipts", () => {
  it("keeps one stable entry per request id", () => {
    rememberPendingGenerationRequest({
      requestId: "r1",
      userId: "account-a",
    });
    rememberPendingGenerationRequest({
      requestId: "r1",
      userId: "account-a",
    });

    const entries = listPendingGenerationRequests("account-a");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ requestId: "r1", userId: "account-a" });
    expect(
      JSON.parse(window.sessionStorage.getItem("pika.pendingGenerationRequests") ?? "[]"),
    ).toEqual(entries);
  });

  it("never hands account A's ids to account B", () => {
    rememberPendingGenerationRequest({
      requestId: "r1",
      userId: "account-a",
    });
    rememberPendingGenerationRequest({
      requestId: "r2",
      userId: "account-b",
    });

    expect(
      listPendingGenerationRequests("account-a").map((entry) => entry.requestId),
    ).toEqual(["r1"]);
    expect(
      listPendingGenerationRequests("account-b").map((entry) => entry.requestId),
    ).toEqual(["r2"]);
  });

  it("forgets one id without touching the other account's bucket", () => {
    rememberPendingGenerationRequest({
      requestId: "r1",
      userId: "account-a",
    });
    rememberPendingGenerationRequest({
      requestId: "r2",
      userId: "account-b",
    });

    forgetPendingGenerationRequest("account-a", "r1");

    expect(listPendingGenerationRequests("account-a")).toEqual([]);
    expect(listPendingGenerationRequests("account-b")).toHaveLength(1);
  });

  it("drops every bucket on sign-out", () => {
    rememberPendingGenerationRequest({
      requestId: "r1",
      userId: "account-a",
    });
    rememberPendingGenerationRequest({
      requestId: "r2",
      userId: "account-b",
    });

    clearPendingGenerationRequests();

    expect(listPendingGenerationRequests("account-a")).toEqual([]);
    expect(listPendingGenerationRequests("account-b")).toEqual([]);
  });

  it("degrades to no receipt instead of throwing on unreadable storage", () => {
    window.sessionStorage.setItem(
      "pika.pendingGenerationRequests",
      "{not json",
    );
    expect(listPendingGenerationRequests("account-a")).toEqual([]);
  });
});
