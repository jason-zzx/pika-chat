import { describe, expect, it } from "vitest";

import { abortStream, registerStream, releaseStream } from "./stream-registry";

describe("stream registry", () => {
  it("aborts a stream owned by the caller", () => {
    const signal = registerStream("s1", "user-a");
    expect(signal.aborted).toBe(false);
    expect(abortStream("s1", "user-a")).toBe(true);
    expect(signal.aborted).toBe(true);
    releaseStream("s1");
  });

  it("rejects a foreign user without aborting", () => {
    const signal = registerStream("s2", "user-a");
    expect(abortStream("s2", "user-b")).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(abortStream("missing", "user-a")).toBe(false);
    releaseStream("s2");
  });
});
