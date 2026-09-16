import { describe, expect, it } from "vitest";

import { newAssistantId, newId, newShortId, newTopicId } from "./id";

describe("newId", () => {
  it("produces a UUIDv7 (version nibble is 7)", () => {
    const id = newId();
    expect(id[14]).toBe("7");
  });

  it("mints ids that sort ascending as strings in a tight loop", () => {
    const ids = Array.from({ length: 200 }, () => newId());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });
});

describe("newShortId", () => {
  it("produces `<prefix>_` plus 12 base62 chars", () => {
    const id = newShortId("x");
    expect(id).toMatch(/^x_[0-9A-Za-z]{12}$/);
  });

  it("mints distinct ids in a tight loop", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newShortId("x")));
    expect(ids.size).toBe(1000);
  });
});

describe("domain ids", () => {
  it("newAssistantId uses the agt prefix", () => {
    expect(newAssistantId()).toMatch(/^agt_[0-9A-Za-z]{12}$/);
  });

  it("newTopicId uses the tpc prefix", () => {
    expect(newTopicId()).toMatch(/^tpc_[0-9A-Za-z]{12}$/);
  });
});
