import "server-only";

import { afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { getDb } from "@/server/db/client";
import { assistants, users } from "@/server/db/schema";
import { insertWithShortId } from "@/server/db/short-id-insert";

const db = getDb();

afterEach(async () => {
  await db.delete(assistants);
  await db.delete(users);
});

describe("insertWithShortId against SQLite", () => {
  it("re-mints after a real primary-key collision", async () => {
    const userId = newId();
    await db.insert(users).values({
      id: userId,
      name: "Owner",
      email: `${userId}@example.test`,
      username: `u_${userId.slice(0, 8)}`,
    });
    await db
      .insert(assistants)
      .values({ id: "agt_taken", ownerId: userId, name: "First", icon: "✨" });

    const minted = ["agt_taken", "agt_fresh"];
    const { id } = insertWithShortId({
      mint: () => minted.shift() ?? "agt_unexpected",
      insert: (candidate) =>
        db
          .insert(assistants)
          .values({ id: candidate, ownerId: userId, name: "Second", icon: "✨" })
          .run(),
    });

    expect(id).toBe("agt_fresh");
    expect(minted).toEqual([]);
  });
});
