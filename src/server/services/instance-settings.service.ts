import "server-only";

import { count, eq } from "drizzle-orm";

import type { InstanceState } from "@/lib/schemas/instance";
import type { InstanceSettings } from "@/lib/schemas/instance-settings";
import { isStaffRole } from "@/lib/auth-hierarchy";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { APP_SETTINGS_ROW_ID, appSettings, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

async function readSettingsRow() {
  const db = getDb();
  const rows = await db
    .select({
      allowRegistration: appSettings.allowRegistration,
    })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "Instance settings are missing");
  }
  return row;
}

export async function getInstanceState(): Promise<InstanceState> {
  const db = getDb();
  const [settings, userCount] = await Promise.all([
    readSettingsRow(),
    db.select({ value: count() }).from(users),
  ]);
  return {
    needsSetup: (userCount[0]?.value ?? 0) === 0,
    allowRegistration: settings.allowRegistration,
  };
}

export async function updateInstanceSettings(
  input: InstanceSettings,
  actor: Actor,
): Promise<InstanceSettings> {
  if (!isStaffRole(actor.role)) {
    throw new AppError("FORBIDDEN", 403, "Admin access required");
  }
  const db = getDb();
  const updated = await db
    .update(appSettings)
    .set({
      allowRegistration: input.allowRegistration,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .returning({ allowRegistration: appSettings.allowRegistration });
  const row = updated[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "Instance settings are missing");
  }
  logger.info(
    { userId: actor.userId, allowRegistration: row.allowRegistration },
    "registration toggle updated",
  );
  return { allowRegistration: row.allowRegistration };
}
