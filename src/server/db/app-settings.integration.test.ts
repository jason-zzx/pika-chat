import "server-only";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import {
  APP_SETTINGS_ROW_ID,
  appSettings,
} from "@/server/db/schema/app-settings";

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}

const connection = postgres(url, { max: 1 });
const db = drizzle(connection, { schema: { appSettings } });

afterAll(async () => {
  await connection.end();
});

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
