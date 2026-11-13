import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { getDb } from "@/server/db/client";
import {
  accounts,
  assistants,
  chatMessages,
  demoUsageCounters,
  files,
  sessions,
  topics,
  users,
} from "@/server/db/schema";
import { getFileStorage } from "@/server/files/storage";
import { purgeInactiveGuests } from "@/server/services/demo-cleanup.service";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(files);
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(demoUsageCounters);
  await db.delete(users);
}

describe("purgeInactiveGuests", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("deletes stale guests and their blobs while keeping active guests and regular users", async () => {
    const now = new Date("2026-11-13T12:00:00.000Z");
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const staleGuestId = newId();
    const activeGuestId = newId();
    const freshGuestId = newId();
    const regularUserId = newId();

    await db.insert(users).values([
      {
        id: staleGuestId,
        name: "Stale Guest",
        email: `${staleGuestId}@anon.invalid`,
        username: `guest-stale-${staleGuestId.slice(-8)}`,
        isAnonymous: true,
        createdAt: tenDaysAgo,
        updatedAt: tenDaysAgo,
      },
      {
        id: activeGuestId,
        name: "Active Guest",
        email: `${activeGuestId}@anon.invalid`,
        username: `guest-active-${activeGuestId.slice(-8)}`,
        isAnonymous: true,
        createdAt: tenDaysAgo,
        updatedAt: tenDaysAgo,
      },
      {
        id: freshGuestId,
        name: "Fresh Guest",
        email: `${freshGuestId}@anon.invalid`,
        username: `guest-fresh-${freshGuestId.slice(-8)}`,
        isAnonymous: true,
        createdAt: twoDaysAgo,
        updatedAt: twoDaysAgo,
      },
      {
        id: regularUserId,
        name: "Regular User",
        email: "regular@example.com",
        username: "regular",
        isAnonymous: false,
        createdAt: tenDaysAgo,
        updatedAt: tenDaysAgo,
      },
    ]);

    // Stale guest has an old expired session; active guest has a recent session.
    await db.insert(sessions).values([
      {
        id: newId(),
        userId: staleGuestId,
        token: newId(),
        expiresAt: twoDaysAgo,
        createdAt: tenDaysAgo,
        updatedAt: tenDaysAgo,
      },
      {
        id: newId(),
        userId: activeGuestId,
        token: newId(),
        expiresAt: now,
        createdAt: tenDaysAgo,
        updatedAt: twoDaysAgo,
      },
    ]);

    const storage = getFileStorage();
    const staleKey = `${staleGuestId}/${newId()}.txt`;
    const activeKey = `${activeGuestId}/${newId()}.txt`;
    await storage.put(staleKey, Buffer.from("stale-blob"));
    await storage.put(activeKey, Buffer.from("active-blob"));

    await db.insert(files).values([
      {
        id: newId(),
        userId: staleGuestId,
        filename: "stale.txt",
        mediaType: "text/plain",
        sizeBytes: 10,
        storageKey: staleKey,
      },
      {
        id: newId(),
        userId: activeGuestId,
        filename: "active.txt",
        mediaType: "text/plain",
        sizeBytes: 11,
        storageKey: activeKey,
      },
    ]);

    const result = await purgeInactiveGuests(now);
    expect(result.guests).toBe(1);

    // Stale guest and blob are gone.
    expect(
      await db.select().from(users).where(eq(users.id, staleGuestId)),
    ).toHaveLength(0);
    await expect(storage.get(staleKey)).rejects.toThrow();

    // Active guest, its blob, fresh guest, and regular user remain.
    expect(
      await db.select().from(users).where(eq(users.id, activeGuestId)),
    ).toHaveLength(1);
    expect((await storage.get(activeKey)).toString()).toBe("active-blob");
    expect(
      await db.select().from(users).where(eq(users.id, freshGuestId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(users).where(eq(users.id, regularUserId)),
    ).toHaveLength(1);

    // Clean up remaining in-memory storage entry so test harness empty check passes.
    await storage.delete(activeKey);
  });

  it("drops usage counters older than yesterday (UTC) and keeps recent ones", async () => {
    const subject = newId();
    await db.insert(demoUsageCounters).values([
      { subject, day: "2026-11-10", kind: "model", count: 3 },
      { subject, day: "2026-11-12", kind: "model", count: 2 },
      { subject, day: "2026-11-13", kind: "search", count: 1 },
    ]);

    const result = await purgeInactiveGuests(
      new Date("2026-11-13T12:00:00.000Z"),
    );
    expect(result.counters).toBe(1);
    const remaining = await db
      .select({ day: demoUsageCounters.day })
      .from(demoUsageCounters)
      .where(eq(demoUsageCounters.subject, subject));
    expect(remaining.map((row) => row.day).sort()).toEqual([
      "2026-11-12",
      "2026-11-13",
    ]);
  });
});
