import "server-only";

import { eq, sql } from "drizzle-orm";

import { formatBytes } from "@/lib/files/format";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  appSettings,
  files,
  users,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";

/**
 * Total bytes the actor's attachments occupy, referenced by a message or not —
 * "how much storage do I use" from the user's point of view. Pending direct
 * uploads carry `sizeBytes = 0` until completed, so they naturally contribute
 * nothing. `SUM` of an integer column is `bigint`; postgres-js has no int8
 * parser, so the value arrives as a string and is narrowed here.
 */
export async function usageBytes(userId: string): Promise<number> {
  const rows = await getDb()
    .select({
      total: sql<string>`coalesce(sum(${files.sizeBytes}), 0)::bigint`,
    })
    .from(files)
    .where(eq(files.userId, userId));
  return Number(rows[0]?.total ?? 0);
}

/**
 * Effective quota for an actor: the per-user override, else the instance-wide
 * default. Both `null` means unlimited. The global default is 5 GiB out of the
 * box, so this returns a number for an un-configured instance.
 */
export async function effectiveQuotaBytes(
  actor: Actor,
): Promise<number | null> {
  const db = getDb();
  const userRow = (
    await db
      .select({ fileQuotaBytes: users.fileQuotaBytes })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1)
  )[0];
  if (userRow?.fileQuotaBytes != null) {
    return userRow.fileQuotaBytes;
  }
  const settingsRow = (
    await db
      .select({ fileStorageQuotaBytes: appSettings.fileStorageQuotaBytes })
      .from(appSettings)
      .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
      .limit(1)
  )[0];
  return settingsRow?.fileStorageQuotaBytes ?? null;
}

/**
 * The quota rejection for a write of `incomingBytes`, or `null` when it is
 * within (or unlimited by) the actor's effective quota. Equality passes:
 * `used + incoming === quota` is exactly full, not over.
 *
 * The detail carries *formatted* sizes (same shape as `file.tooLarge`'s
 * `limit`) because the client interpolates them directly into the localized
 * message. Concurrent uploads can both pass this check and overshoot by at
 * most the in-flight bytes each — the quota is an operational bound, not an
 * exact ledger, so no lock is taken.
 */
export async function quotaExceededError(
  actor: Actor,
  incomingBytes: number,
): Promise<AppError | null> {
  const [quota, used] = await Promise.all([
    effectiveQuotaBytes(actor),
    usageBytes(actor.userId),
  ]);
  if (quota === null || used + incomingBytes <= quota) {
    return null;
  }
  return new AppError("QUOTA_EXCEEDED", 413, "file.quotaExceeded", {
    used: formatBytes(used),
    quota: formatBytes(quota),
  });
}

/** {@link quotaExceededError} as a guard for write paths with no cleanup. */
export async function assertUploadQuota(
  actor: Actor,
  incomingBytes: number,
): Promise<void> {
  const error = await quotaExceededError(actor, incomingBytes);
  if (error) {
    throw error;
  }
}
