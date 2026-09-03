import { describe, expect, it } from "vitest";

import { resolvedMaxOutputTokens } from "./output-budget";

describe("resolvedMaxOutputTokens", () => {
  it("uses the stored output budget when it fits in context", () => {
    expect(
      resolvedMaxOutputTokens({ outputTokens: 384000, contextTokens: 1_000_000 }),
    ).toBe(384000);
  });

  it("never exceeds the context window", () => {
    expect(
      resolvedMaxOutputTokens({ outputTokens: 65536, contextTokens: 8000 }),
    ).toBe(8000);
  });
});
