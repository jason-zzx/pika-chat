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

export async function createFirstAdmin(input: CredentialsInput): Promise<{
  userId: string;
  email: string;
  username: string;
}> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx
      .select({ id: appSettings.id })
      .from(appSettings)
      .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
      .for("update");

    const counted = await tx.select({ value: count() }).from(users);
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
}
