import "server-only";

import { eq } from "drizzle-orm";

import type { CredentialsInput } from "@/lib/schemas/credentials";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { APP_SETTINGS_ROW_ID, appSettings } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  assertUsernameAvailable,
  throwIfAccountCreateFailed,
} from "@/server/services/account-create";

export async function registerUser(input: CredentialsInput): Promise<{
  userId: string;
  email: string;
  username: string;
}> {
  const db = getDb();
  const rows = await db
    .select({ allowRegistration: appSettings.allowRegistration })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .limit(1);
  const settings = rows[0];
  if (!settings?.allowRegistration) {
    throw new AppError("FORBIDDEN", 403, "registration.disabled");
  }

  await assertUsernameAvailable(input.username);

  try {
    const created = await auth.api.createUser({
      body: {
        email: input.email,
        password: input.password,
        name: input.username,
        role: "user",
        data: { username: input.username },
      },
    });
    logger.info({ userId: created.user.id, role: "user" }, "user created");
    return {
      userId: created.user.id,
      email: created.user.email,
      username: input.username,
    };
  } catch (error) {
    throwIfAccountCreateFailed(error);
  }
}
