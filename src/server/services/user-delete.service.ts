import "server-only";

import { eq } from "drizzle-orm";

import { canAdminister, parseActorRole } from "@/lib/auth-hierarchy";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { files, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { deleteProviderFileReferences } from "@/server/files/provider-delete";
import { getFileStorage } from "@/server/files/storage";
import { logger } from "@/server/logger";

/**
 * Removes a user's attachment objects, file rows and provider references, then
 * the user row (which cascades the rest). The user row is kept when any file
 * fails, so a retry can still find the remaining blobs.
 */
export async function deleteUserAccount(userId: string): Promise<boolean> {
  const db = getDb();
  const storage = getFileStorage();
  const userFiles = await db
    .select({
      id: files.id,
      storageKey: files.storageKey,
      providerReferences: files.providerReferences,
    })
    .from(files)
    .where(eq(files.userId, userId));

  let failed = false;
  for (const file of userFiles) {
    try {
      await storage.delete(file.storageKey);
      await db.delete(files).where(eq(files.id, file.id));
      await deleteProviderFileReferences(file);
    } catch (error) {
      failed = true;
      logger.warn(
        { err: error, userId, fileId: file.id },
        "failed to delete user attachment",
      );
    }
  }
  if (failed) {
    return false;
  }
  await db.delete(users).where(eq(users.id, userId));
  return true;
}

export async function removeUser(userId: string, actor: Actor): Promise<void> {
  const target = (
    await getDb()
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!target) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  if (
    !canAdminister(
      actor,
      { userId: target.id, role: parseActorRole(target.role) },
      "remove-user",
    )
  ) {
    throw new AppError("FORBIDDEN", 403, "auth.targetNotAllowed");
  }
  if (!(await deleteUserAccount(userId))) {
    throw new AppError("INTERNAL", 500, "auth.userDeleteFailed");
  }
  logger.info({ userId: actor.userId, targetUserId: userId }, "user deleted");
}
