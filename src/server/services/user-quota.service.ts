import "server-only";

import { eq } from "drizzle-orm";

import { canAdminister, parseActorRole } from "@/lib/auth-hierarchy";
import { BYTES_PER_MB } from "@/lib/files/constants";
import type { UserQuotaResponse } from "@/lib/schemas/user-quota";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

async function loadTarget(userId: string) {
  const row = (
    await getDb()
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  return row;
}

/** Reads one user's quota override for the admin dialog. */
export async function getUserQuota(userId: string): Promise<UserQuotaResponse> {
  const row = (
    await getDb()
      .select({ id: users.id, fileQuotaBytes: users.fileQuotaBytes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  return { userId: row.id, quotaBytes: row.fileQuotaBytes };
}

/**
 * Admin mutation of one user's storage quota override. This column is not part
 * of Better Auth's admin plugin, so it is a project-owned endpoint and applies
 * the same target hierarchy as the plugin's actions (`canAdminister`) rather
 * than trusting the UI to hide the wrong rows. `null` clears the override.
 */
export async function updateUserQuota(
  userId: string,
  quotaMb: number | null,
  actor: Actor,
): Promise<UserQuotaResponse> {
  const target = await loadTarget(userId);
  if (
    !canAdminister(actor, {
      userId: target.id,
      role: parseActorRole(target.role),
    }, "set-quota")
  ) {
    throw new AppError("FORBIDDEN", 403, "auth.targetNotAllowed");
  }
  const quotaBytes = quotaMb === null ? null : quotaMb * BYTES_PER_MB;
  const updated = await getDb()
    .update(users)
    .set({ fileQuotaBytes: quotaBytes, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id, fileQuotaBytes: users.fileQuotaBytes });
  const row = updated[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  logger.info(
    { userId: actor.userId, targetUserId: row.id, quotaMb },
    "user storage quota updated",
  );
  return { userId: row.id, quotaBytes: row.fileQuotaBytes ?? null };
}
