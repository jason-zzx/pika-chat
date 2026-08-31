import { describe, expect, it } from "vitest";

import { newId } from "./id";

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
