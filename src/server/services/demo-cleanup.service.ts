import "server-only";

import { and, eq, gte, lt, notInArray } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { demoUsageCounters, sessions, users } from "@/server/db/schema";
import { logger } from "@/server/logger";
import { deleteUserAccount } from "@/server/services/user-delete.service";
import { utcDayString } from "@/server/services/demo-usage.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const GUEST_RETENTION_DAYS = 7;
const PURGE_BATCH_SIZE = 100;

/**
 * Deletes anonymous demo guests inactive for more than 7 days along with
 * their stored attachment blobs and provider file references, and prunes old
 * daily usage ledger rows.
 */
export async function purgeInactiveGuests(
  now: Date = new Date(),
): Promise<{ guests: number; counters: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - GUEST_RETENTION_DAYS * DAY_MS);

  // Active guests are those with a session refreshed within the retention
  // window (sessions refresh at most once per day on activity).
  const activeSessionUserIds = db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(gte(sessions.updatedAt, cutoff));

  const staleGuests = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isAnonymous, true),
        lt(users.createdAt, cutoff),
        notInArray(users.id, activeSessionUserIds),
      ),
    )
    .limit(PURGE_BATCH_SIZE);

  let deletedGuests = 0;

  for (const guest of staleGuests) {
    if (await deleteUserAccount(guest.id)) {
      deletedGuests += 1;
    }
  }

  // Drop usage ledger rows older than yesterday (UTC).
  const counters = (
    await db
      .delete(demoUsageCounters)
      .where(
        lt(demoUsageCounters.day, utcDayString(new Date(now.getTime() - DAY_MS))),
      )
      .returning({ subject: demoUsageCounters.subject })
  ).length;
  if (deletedGuests > 0 || counters > 0) {
    logger.info(
      { guests: deletedGuests, counters },
      "inactive demo guests purged",
    );
  }
  return { guests: deletedGuests, counters };
}
