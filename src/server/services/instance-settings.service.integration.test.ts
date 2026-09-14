import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { BYTES_PER_MB } from "@/lib/files/constants";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  DEFAULT_FILE_STORAGE_QUOTA_BYTES,
  appSettings,
} from "@/server/db/schema";

import {
  getInstanceSettings,
  updateInstanceSettings,
} from "./instance-settings.service";

const db = getDb();
const admin = { userId: "admin-1", role: "admin" as const };
const member = { userId: "user-1", role: "user" as const };

async function resetRow(): Promise<void> {
  await db
    .update(appSettings)
    .set({
      allowRegistration: false,
      fileStorageQuotaBytes: DEFAULT_FILE_STORAGE_QUOTA_BYTES,
    })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
}

describe("instance-settings service", () => {
  beforeEach(async () => {
    await resetRow();
  });

  afterAll(async () => {
    await resetRow();
  });

  it("defaults to the 5 GiB quota (5120 MB)", async () => {
    const settings = await getInstanceSettings();
    expect(settings.fileStorageQuotaMb).toBe(5120);
  });

  it("stores MB as bytes and flips one field without touching the other", async () => {
    await updateInstanceSettings({ fileStorageQuotaMb: 100 }, admin);

    const rows = await db
      .select({
        allowRegistration: appSettings.allowRegistration,
        fileStorageQuotaBytes: appSettings.fileStorageQuotaBytes,
      })
      .from(appSettings)
      .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
    expect(rows[0]).toEqual({
      allowRegistration: false,
      fileStorageQuotaBytes: 100 * BYTES_PER_MB,
    });

    const settings = await updateInstanceSettings(
      { allowRegistration: true },
      admin,
    );
    expect(settings).toEqual({
      allowRegistration: true,
      fileStorageQuotaMb: 100,
    });
  });

  it("clears the global quota to unlimited with null", async () => {
    await updateInstanceSettings({ fileStorageQuotaMb: null }, admin);
    const settings = await getInstanceSettings();
    expect(settings.fileStorageQuotaMb).toBeNull();
  });

  it("rejects a non-staff actor", async () => {
    await expect(
      updateInstanceSettings({ fileStorageQuotaMb: 10 }, member),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});
