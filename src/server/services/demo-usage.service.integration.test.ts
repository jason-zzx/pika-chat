import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { getDb } from "@/server/db/client";
import { demoUsageCounters, users } from "@/server/db/schema";
import {
  consumeDemoQuota,
  consumeGuestModelTurnQuota,
  getGuestUsage,
} from "@/server/services/demo-usage.service";

const db = getDb();

async function resetDemoState(): Promise<void> {
  await db.delete(demoUsageCounters);
  await db.delete(users);
}

describe("demo-usage.service", () => {
  beforeEach(async () => {
    await resetDemoState();
  });

  afterAll(async () => {
    await resetDemoState();
  });

  it("enforces atomic limit boundary, concurrent consumes, and UTC day rollover", async () => {
    const subject = newId();
    const day1 = "2026-11-13";
    const day2 = "2026-11-14";

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        consumeDemoQuota({ subject, kind: "model", limit: 3, day: day1 }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(results.filter((ok) => !ok)).toHaveLength(3);

    // Next UTC day gets a fresh bucket.
    await expect(
      consumeDemoQuota({ subject, kind: "model", limit: 3, day: day2 }),
    ).resolves.toBe(true);
  });

  it("rolls back both guest and global counters when the enclosing transaction fails", async () => {
    const guestId = newId();

    await expect(
      db.transaction(async (tx) => {
        await consumeGuestModelTurnQuota(guestId, tx);
        throw new Error("simulated tx abort");
      }),
    ).rejects.toThrow("simulated tx abort");

    const usage = await getGuestUsage(guestId);
    expect(usage.model.used).toBe(0);

    const globalRows = await db
      .select()
      .from(demoUsageCounters)
      .where(eq(demoUsageCounters.subject, "global"));
    expect(globalRows).toHaveLength(0);
  });

  it("reports each kind's count independently in getGuestUsage", async () => {
    const guestId = newId();
    await consumeDemoQuota({ subject: guestId, kind: "search", limit: 10 });
    await consumeDemoQuota({ subject: guestId, kind: "upload", limit: 5 });
    await consumeDemoQuota({ subject: guestId, kind: "upload", limit: 5 });

    await expect(getGuestUsage(guestId)).resolves.toEqual({
      model: { used: 0, limit: 10 },
      search: { used: 1, limit: 10 },
      upload: { used: 2, limit: 5 },
    });
  });
});
