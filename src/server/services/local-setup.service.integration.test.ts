import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { requireActor } from "@/server/auth/actor";
import { authPost, cookiesFrom, jsonRequest } from "@/server/auth/auth-test-helpers";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  DEFAULT_FILE_STORAGE_QUOTA_BYTES,
  accounts,
  appSettings,
  sessions,
  users,
  verifications,
} from "@/server/db/schema";
import { effectiveQuotaBytes } from "@/server/files/quota";
import { ensureLocalAdmin } from "@/server/services/setup.service";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
  await db
    .update(appSettings)
    .set({
      fileStorageQuotaBytes: DEFAULT_FILE_STORAGE_QUOTA_BYTES,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
}

describe("ensureLocalAdmin", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("provisions the local super admin once, clears storage quota, and is idempotent", async () => {
    await ensureLocalAdmin("local-pass-1234");
    await ensureLocalAdmin("different-password-ignored");

    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]).toMatchObject({
      email: "local@pika.local",
      username: "local",
      role: "super_admin",
    });

    const settings = (
      await db
        .select({ fileStorageQuotaBytes: appSettings.fileStorageQuotaBytes })
        .from(appSettings)
        .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    )[0];
    expect(settings?.fileStorageQuotaBytes).toBeNull();

    const signIn = await authPost(
      jsonRequest("/api/auth/sign-in/username", {
        body: { username: "local", password: "local-pass-1234" },
      }),
    );
    expect(signIn.status).toBe(200);
    const cookie = cookiesFrom(signIn);
    const actor = await requireActor(
      jsonRequest("/api/topics", { cookie }).headers,
    );
    expect(actor.role).toBe("super_admin");
    expect(await effectiveQuotaBytes(actor)).toBeNull();
  });
});
