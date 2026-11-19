import "server-only";

import { count, eq } from "drizzle-orm";

import type { CredentialsInput } from "@/lib/schemas/credentials";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { APP_SETTINGS_ROW_ID, appSettings, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  assertUsernameAvailable,
  throwIfAccountCreateFailed,
} from "@/server/services/account-create";

// auth.api.createUser and assertUsernameAvailable call getDb(), which would
// deadlock inside a single-connection PGlite transaction; serialize in-process
// instead of holding an app_settings row lock.
let setupQueue: Promise<unknown> = Promise.resolve();

export async function createFirstAdmin(input: CredentialsInput): Promise<{
  userId: string;
  email: string;
  username: string;
}> {
  const run = setupQueue.then(async () => {
    const counted = await getDb().select({ value: count() }).from(users);
    if ((counted[0]?.value ?? 0) > 0) {
      throw new AppError("FORBIDDEN", 403, "setup.alreadyCompleted");
    }

    await assertUsernameAvailable(input.username);

    try {
      const created = await auth.api.createUser({
        body: {
          email: input.email,
          password: input.password,
          name: input.username,
          role: "super_admin",
          data: { username: input.username },
        },
      });
      logger.info({ userId: created.user.id, role: "super_admin" }, "user created");
      return {
        userId: created.user.id,
        email: created.user.email,
        username: input.username,
      };
    } catch (error) {
      throwIfAccountCreateFailed(error);
    }
  });
  setupQueue = run.catch(() => undefined);
  return run;
}

/**
 * Provisions the single local super admin and clears the default global storage
 * quota to unlimited on first boot in local mode. Safe to run on every boot.
 */
export async function ensureLocalAdmin(password: string): Promise<void> {
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    return;
  }

  // Quota first: a crash between the two writes must not leave the admin
  // provisioned with the default quota, since later boots skip this block.
  await db
    .update(appSettings)
    .set({ fileStorageQuotaBytes: null, updatedAt: new Date() })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
  await auth.api.createUser({
    body: {
      email: "local@pika.local",
      password,
      name: "local",
      role: "super_admin",
      data: { username: "local" },
    },
  });
  logger.info("local admin provisioned");
}
