import { describe, expect, it } from "vitest";

import { insertWithShortId } from "./short-id-insert";

function uniqueViolation(): Error {
  const error = new Error("duplicate key") as Error & { code: string };
  error.code = "23505";
  return error;
}

describe("insertWithShortId", () => {
  it("returns the minted id and insert result on first success", async () => {
    const out = await insertWithShortId({
      mint: () => "agt_first",
      insert: async (id) => ({ insertedId: id }),
    });
    expect(out).toEqual({
      id: "agt_first",
      result: { insertedId: "agt_first" },
    });
  });

  it("re-mints and retries on a unique violation", async () => {
    const minted: string[] = [];
    const out = await insertWithShortId({
      mint: () => {
        const id = `tpc_${minted.length + 1}`;
        minted.push(id);
        return id;
      },
      insert: async (id) => {
        if (id === "tpc_1") {
          throw uniqueViolation();
        }
        return { insertedId: id };
      },
    });
    expect(out.id).toBe("tpc_2");
    expect(minted).toEqual(["tpc_1", "tpc_2"]);
  });

  it("rethrows non-unique errors without retrying", async () => {
    let attempts = 0;
    await expect(
      insertWithShortId({
        mint: () => "agt_x",
        insert: async () => {
          attempts += 1;
          throw new Error("connection lost");
        },
      }),
    ).rejects.toThrow("connection lost");
    expect(attempts).toBe(1);
  });

  it("gives up after three attempts when every minted id collides", async () => {
    let attempts = 0;
    await expect(
      insertWithShortId({
        mint: () => "agt_x",
        insert: async () => {
          attempts += 1;
          throw uniqueViolation();
        },
      }),
    ).rejects.toThrow("duplicate key");
    expect(attempts).toBe(3);
  });
});
