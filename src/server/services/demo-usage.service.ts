import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { DemoUsageResponse } from "@/lib/schemas/demo";
import { getDb, type DbTransaction } from "@/server/db/client";
import { demoUsageCounters } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";

export type DemoUsageKind = "model" | "search" | "upload" | "guest";

/** Current UTC calendar day as `YYYY-MM-DD`, matching `timezone('UTC', now())::date`. */
export function utcDayString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Atomically consumes one unit of a daily quota counter. Returns true when the
 * increment stayed within `limit`, or false when the bucket is already full.
 */
export async function consumeDemoQuota(
  input: {
    subject: string;
    kind: DemoUsageKind;
    limit: number;
    day?: string;
    tx?: DbTransaction;
  },
): Promise<boolean> {
  const executor = input.tx ?? getDb();
  const day = input.day ?? utcDayString();
  const rows = await executor.execute<{ count: number }>(sql`
    insert into demo_usage_counters (subject, day, kind, count)
    values (${input.subject}, ${day}::date, ${input.kind}, 1)
    on conflict (subject, day, kind)
    do update set count = demo_usage_counters.count + 1
    where demo_usage_counters.count < ${input.limit}
    returning count
  `);
  return rows.length > 0;
}

/**
 * Consumes a guest turn's model call and the global guest ceiling inside the
 * admission transaction (so a later rollback refunds both).
 */
export async function consumeGuestModelTurnQuota(
  userId: string,
  tx: DbTransaction,
): Promise<void> {
  const env = getEnv();
  const guestAllowed = await consumeDemoQuota({
    subject: userId,
    kind: "model",
    limit: env.DEMO_DAILY_MODEL_CALLS,
    tx,
  });
  if (!guestAllowed) {
    throw new AppError("RATE_LIMITED", 429, "demo.modelLimit");
  }
  const globalAllowed = await consumeDemoQuota({
    subject: "global",
    kind: "model",
    limit: env.DEMO_GLOBAL_DAILY_MODEL_CALLS,
    tx,
  });
  if (!globalAllowed) {
    throw new AppError("RATE_LIMITED", 429, "demo.globalLimit");
  }
}

/** Reads today's usage and limits for a guest user. */
export async function getGuestUsage(
  userId: string,
  day: string = utcDayString(),
): Promise<DemoUsageResponse> {
  const env = getEnv();
  const rows = await getDb()
    .select({
      kind: demoUsageCounters.kind,
      count: demoUsageCounters.count,
    })
    .from(demoUsageCounters)
    .where(
      and(
        eq(demoUsageCounters.subject, userId),
        eq(demoUsageCounters.day, day),
      ),
    );
  const counts = new Map(rows.map((row) => [row.kind, row.count]));
  return {
    model: {
      used: counts.get("model") ?? 0,
      limit: env.DEMO_DAILY_MODEL_CALLS,
    },
    search: {
      used: counts.get("search") ?? 0,
      limit: env.DEMO_DAILY_SEARCH_CALLS,
    },
    upload: {
      used: counts.get("upload") ?? 0,
      limit: env.DEMO_DAILY_UPLOADS,
    },
  };
}
