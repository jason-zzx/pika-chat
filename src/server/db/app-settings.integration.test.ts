import "server-only";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  appSettings,
} from "@/server/db/schema/app-settings";

const db = getDb();

describe("app_settings", () => {
  it("has the seeded instance row with registration closed", async () => {
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));

    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.allowRegistration).toBe(false);
  });
});
