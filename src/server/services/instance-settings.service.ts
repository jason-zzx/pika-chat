import "server-only";

import { count, eq } from "drizzle-orm";

import { isStaffRole } from "@/lib/auth-hierarchy";
import { BYTES_PER_MB } from "@/lib/files/constants";
import type { InstanceState } from "@/lib/schemas/instance";
import type {
  InstanceSettings,
  InstanceSettingsResponse,
} from "@/lib/schemas/instance-settings";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { APP_SETTINGS_ROW_ID, appSettings, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

type SettingsRow = {
  allowRegistration: boolean;
  fileStorageQuotaBytes: number | null;
};

async function readSettingsRow(): Promise<SettingsRow> {
  const db = getDb();
  const rows = await db
    .select({
      allowRegistration: appSettings.allowRegistration,
      fileStorageQuotaBytes: appSettings.fileStorageQuotaBytes,
    })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "instanceSettings.missing");
  }
  return row;
}

/** Bytes in the database, MB on the wire — the conversion lives here only. */
function toResponse(row: SettingsRow): InstanceSettingsResponse {
  return {
    allowRegistration: row.allowRegistration,
    fileStorageQuotaMb:
      row.fileStorageQuotaBytes === null
        ? null
        : row.fileStorageQuotaBytes / BYTES_PER_MB,
  };
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

/** Full settings for the admin UI (`GET /api/admin/settings`). */
export async function getInstanceSettings(): Promise<InstanceSettingsResponse> {
  return toResponse(await readSettingsRow());
}

export async function updateInstanceSettings(
  input: InstanceSettings,
  actor: Actor,
): Promise<InstanceSettingsResponse> {
  if (!isStaffRole(actor.role)) {
    throw new AppError("FORBIDDEN", 403, "auth.adminRequired");
  }
  const patch: {
    allowRegistration?: boolean;
    fileStorageQuotaBytes?: number | null;
  } = {};
  if (input.allowRegistration !== undefined) {
    patch.allowRegistration = input.allowRegistration;
  }
  if (input.fileStorageQuotaMb !== undefined) {
    patch.fileStorageQuotaBytes =
      input.fileStorageQuotaMb === null
        ? null
        : input.fileStorageQuotaMb * BYTES_PER_MB;
  }
  const db = getDb();
  const updated = await db
    .update(appSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .returning({
      allowRegistration: appSettings.allowRegistration,
      fileStorageQuotaBytes: appSettings.fileStorageQuotaBytes,
    });
  const row = updated[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "instanceSettings.missing");
  }
  const settings = toResponse(row);
  logger.info(
    {
      userId: actor.userId,
      allowRegistration: settings.allowRegistration,
      fileStorageQuotaMb: settings.fileStorageQuotaMb,
    },
    "instance settings updated",
  );
  return settings;
}
