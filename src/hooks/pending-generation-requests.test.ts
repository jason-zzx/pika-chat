import { beforeEach, describe, expect, it } from "vitest";

// Lives in the jsdom project because the store is sessionStorage-backed.
import {
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
  it("keeps one entry per request id", () => {
    rememberPendingGenerationRequest({ requestId: "r1", userId: "account-a" });
    rememberPendingGenerationRequest({ requestId: "r1", userId: "account-a" });

    expect(listPendingGenerationRequests("account-a")).toEqual([
      { requestId: "r1", userId: "account-a" },
    ]);
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

    forgetPendingGenerationRequest("account-a", "r1");

    expect(listPendingGenerationRequests("account-a")).toEqual([]);
    expect(listPendingGenerationRequests("account-b")).toHaveLength(1);
  });

  it("degrades to no receipt instead of throwing on unreadable storage", () => {
    window.sessionStorage.setItem(
      "pika.pendingGenerationRequests",
      "{not json",
    );
    expect(listPendingGenerationRequests("account-a")).toEqual([]);
  });
});
