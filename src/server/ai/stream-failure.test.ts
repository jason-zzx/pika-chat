import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../messages/en.json";
import type { ProviderErrorDescription } from "./provider-error";
import { createStreamFailureTracker } from "./stream-failure";

const t = createTranslator({ locale: "en", messages, namespace: "Errors" });

function verbatim(message: string): ProviderErrorDescription {
  return { code: "PROVIDER_ERROR", kind: "verbatim", message };
}

describe("createStreamFailureTracker", () => {
  it("reports nothing until a failure is described", () => {
    const failure = createStreamFailureTracker(vi.fn(), t);
    expect(failure.sawFailure).toBe(false);
    expect(failure.message).toBeNull();
  });

  // The SDK delivers the same failure to both error hooks. Resolving once is
  // what makes the text the row persists and the text the client receives the
  // same string — the property the transcript's live/reloaded convergence
  // rests on.
  it("resolves once, so both hooks agree on the text", () => {
    const describeError = vi.fn((error: unknown) =>
      verbatim(error instanceof Error ? error.message : "?"),
    );
    const failure = createStreamFailureTracker(describeError, t);

    expect(failure.describe(new Error("inner"))).toBe("inner");
    expect(failure.describe(new Error("outer"))).toBe("inner");
    expect(describeError).toHaveBeenCalledTimes(1);
    expect(failure.sawFailure).toBe(true);
    expect(failure.message).toBe("inner");
  });

  it("localizes our own copy for the request locale", () => {
    const failure = createStreamFailureTracker(
      () => ({
        code: "RATE_LIMITED",
        kind: "key",
        messageKey: "provider.rateLimited",
      }),
      t,
    );
    expect(failure.describe(new Error("x"))).toBe(
      "Provider rate limit reached",
    );
  });
});
