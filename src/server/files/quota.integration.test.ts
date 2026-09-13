import "server-only";

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  DEFAULT_FILE_STORAGE_QUOTA_BYTES,
  accounts,
  appSettings,
  assistants,
  chatMessages,
  files,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";

import { uploadFile } from "./file.service";
import { assertUploadQuota, effectiveQuotaBytes, usageBytes } from "./quota";

// A throwaway storage root; the successful-upload case writes real bytes.
const storageRoot = join(tmpdir(), `pika-quota-it-${process.pid}-${newId()}`);
process.env.FILE_STORAGE_DIR = storageRoot;

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(files);
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
  await setGlobalQuota(DEFAULT_FILE_STORAGE_QUOTA_BYTES);
}

async function seedUser(label: string): Promise<Actor> {
  const id = newId();
  await db.insert(users).values({
    id,
    name: label,
    email: `${label}-${id}@example.com`,
    username: `${label}-${id}`,
  });
  return { userId: id, role: "user" };
}

async function setGlobalQuota(bytes: number | null): Promise<void> {
  await db
    .update(appSettings)
    .set({ fileStorageQuotaBytes: bytes })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
}

async function setUserQuota(
  userId: string,
  bytes: number | null,
): Promise<void> {
  await db
    .update(users)
    .set({ fileQuotaBytes: bytes })
    .where(eq(users.id, userId));
}

/** Inserts a stored-attachment row so usage reflects it without an upload. */
async function seedFile(userId: string, sizeBytes: number): Promise<void> {
  await db.insert(files).values({
    id: newId(),
    userId,
    filename: "seed.txt",
    mediaType: "text/plain",
    sizeBytes,
    storageKey: `${userId}/${newId()}`,
  });
}

async function fileCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: files.id })
    .from(files)
    .where(eq(files.userId, userId));
  return rows.length;
}

describe("quota", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
    await rm(storageRoot, { recursive: true, force: true });
  });

  describe("usageBytes", () => {
    it("is zero without rows and sums every stored row", async () => {
      const owner = await seedUser("owner");
      expect(await usageBytes(owner.userId)).toBe(0);
      await seedFile(owner.userId, 100);
      await seedFile(owner.userId, 250);
      expect(await usageBytes(owner.userId)).toBe(350);
    });

    it("ignores other users' rows", async () => {
      const owner = await seedUser("owner");
      const other = await seedUser("other");
      await seedFile(other.userId, 500);
      expect(await usageBytes(owner.userId)).toBe(0);
    });
  });

  describe("effectiveQuotaBytes", () => {
    it("defaults to the 5 GiB instance default", async () => {
      const owner = await seedUser("owner");
      expect(await effectiveQuotaBytes(owner)).toBe(
        DEFAULT_FILE_STORAGE_QUOTA_BYTES,
      );
    });

    it("is null when the global default is cleared and there is no override", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(null);
      expect(await effectiveQuotaBytes(owner)).toBeNull();
    });

    it("uses the global default when the override is null", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(100);
      await setUserQuota(owner.userId, null);
      expect(await effectiveQuotaBytes(owner)).toBe(100);
    });

    it("prefers the per-user override over the global default", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(100);
      await setUserQuota(owner.userId, 500);
      expect(await effectiveQuotaBytes(owner)).toBe(500);
    });

    it("honours an override even when the global default is cleared", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(null);
      await setUserQuota(owner.userId, 500);
      expect(await effectiveQuotaBytes(owner)).toBe(500);
    });
  });

  describe("assertUploadQuota", () => {
    it("passes when unlimited", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(null);
      await expect(
        assertUploadQuota(owner, Number.MAX_SAFE_INTEGER),
      ).resolves.toBeUndefined();
    });

    it("allows an exact fill and rejects one byte over", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(1000);
      await seedFile(owner.userId, 400);

      await expect(assertUploadQuota(owner, 600)).resolves.toBeUndefined();
      await expect(assertUploadQuota(owner, 601)).rejects.toMatchObject({
        code: "QUOTA_EXCEEDED",
        status: 413,
        messageKey: "file.quotaExceeded",
        params: { used: "400 B", quota: "1000 B" },
      });
    });

    it("applies the per-user override", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(10 * 1024 * 1024);
      await setUserQuota(owner.userId, 500);
      await expect(assertUploadQuota(owner, 501)).rejects.toMatchObject({
        code: "QUOTA_EXCEEDED",
        params: { quota: "500 B" },
      });
    });
  });

  describe("uploadFile", () => {
    it("rejects a file that would exceed the quota without storing it", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(100);
      await seedFile(owner.userId, 90);

      await expect(
        uploadFile(
          {
            filename: "notes.txt",
            mediaType: "text/plain",
            data: Buffer.from("x".repeat(11)),
          },
          owner,
        ),
      ).rejects.toMatchObject({
        code: "QUOTA_EXCEEDED",
        status: 413,
        messageKey: "file.quotaExceeded",
      });
      // Only the seeded row remains: the rejected upload wrote no row (and,
      // because the check precedes `storage.put`, no object).
      expect(await fileCount(owner.userId)).toBe(1);
    });

    it("stores a file that fits", async () => {
      const owner = await seedUser("owner");
      await setGlobalQuota(1000);
      await seedFile(owner.userId, 100);

      const uploaded = await uploadFile(
        {
          filename: "notes.txt",
          mediaType: "text/plain",
          data: Buffer.from("hello"),
        },
        owner,
      );
      expect(uploaded.sizeBytes).toBe(5);
      expect(await usageBytes(owner.userId)).toBe(105);
    });
  });
});
