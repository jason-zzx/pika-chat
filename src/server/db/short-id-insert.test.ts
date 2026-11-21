import { describe, expect, it } from "vitest";

import { insertWithShortId } from "./short-id-insert";

function uniqueViolation(): Error {
  const error = new Error("UNIQUE constraint failed") as Error & { code: string };
  error.code = "SQLITE_CONSTRAINT_UNIQUE";
  return error;
}

describe("insertWithShortId", () => {
  it("returns the minted id and insert result on first success", () => {
    const out = insertWithShortId({
      mint: () => "agt_first",
      insert: (id) => ({ insertedId: id }),
    });
    expect(out).toEqual({
      id: "agt_first",
      result: { insertedId: "agt_first" },
    });
  });

  it("re-mints and retries on a unique violation", () => {
    const minted: string[] = [];
    const out = insertWithShortId({
      mint: () => {
        const id = `tpc_${minted.length + 1}`;
        minted.push(id);
        return id;
      },
      insert: (id) => {
        if (id === "tpc_1") {
          throw uniqueViolation();
        }
        return { insertedId: id };
      },
    });
    expect(out.id).toBe("tpc_2");
    expect(minted).toEqual(["tpc_1", "tpc_2"]);
  });

  it("rethrows non-unique errors without retrying", () => {
    let attempts = 0;
    expect(() =>
      insertWithShortId({
        mint: () => "agt_x",
        insert: () => {
          attempts += 1;
          throw new Error("connection lost");
        },
      }),
    ).toThrow("connection lost");
    expect(attempts).toBe(1);
  });

  it("gives up after three attempts when every minted id collides", () => {
    let attempts = 0;
    expect(() =>
      insertWithShortId({
        mint: () => "agt_x",
        insert: () => {
          attempts += 1;
          throw uniqueViolation();
        },
      }),
    ).toThrow("UNIQUE constraint failed");
    expect(attempts).toBe(3);
  });
});
