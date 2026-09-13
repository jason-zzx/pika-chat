import "server-only";

import { rm } from "node:fs/promises";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib/id";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  accounts,
  assistants,
  chatMessages,
  files,
  providerFileDeleteRetries,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";

const { mockStorageRoot, presignCalls, maxFileBytes } = vi.hoisted(() => ({
  mockStorageRoot: `/tmp/pika-files-direct-${process.pid}-${Date.now()}`,
  presignCalls: [] as Array<{
    key: string;
    maxBytes: number;
    expiresSec: number;
  }>,
  // A 1 MiB ceiling keeps the oversize branch cheap. The env→bytes mapping is
  // covered by limits.test.ts; this file is about the direct-upload lifecycle.
  maxFileBytes: vi.fn(() => 1024 * 1024),
}));

// A hybrid backend: a real local-disk store for put/get/delete (so the test
// can simulate the browser's direct POST) plus a stub presigner. `S3FileStorage`
// signs a real policy; here we only assert what the service asked for.
vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  const disk = new actual.LocalDiskFileStorage(mockStorageRoot);
  const hybrid = {
    put: (key: string, data: Buffer) => disk.put(key, data),
    get: (key: string) => disk.get(key),
    delete: (key: string) => disk.delete(key),
    createPresignedPost: async (
      key: string,
      options: { maxBytes: number; expiresSec: number },
    ) => {
      presignCalls.push({ key, ...options });
      return {
        url: "https://storage.test/pika-attachments",
        fields: { key, policy: "signed" },
      };
    },
  };
  return { ...actual, getFileStorage: () => hybrid };
});

vi.mock("./limits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./limits")>();
  return { ...actual, maxFileBytes };
});

import {
  completeFile,
  ORPHAN_FILE_TTL_MS,
  presignFile,
  sweepOrphanFiles,
} from "./file.service";
import { getFileStorage } from "./storage";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(providerFileDeleteRetries);
  await db.delete(files);
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
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

async function fileRowCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: files.id })
    .from(files)
    .where(eq(files.userId, userId));
  return rows.length;
}

async function fileRow(id: string) {
  const rows = await db.select().from(files).where(eq(files.id, id));
  const row = rows[0];
  if (!row) {
    throw new Error(`missing file row ${id}`);
  }
  return row;
}

describe("direct upload", () => {
  beforeEach(async () => {
    presignCalls.length = 0;
    maxFileBytes.mockReturnValue(1024 * 1024);
    await resetState();
  });

  afterAll(async () => {
    await resetState();
    await rm(mockStorageRoot, { recursive: true, force: true });
  });

  it("presigns a bounded policy and leaves a pending row", async () => {
    const owner = await seedUser("owner");

    const presigned = await presignFile(
      { filename: "notes.txt", mediaType: "text/plain" },
      owner,
    );

    expect(presigned.post).toEqual({
      url: "https://storage.test/pika-attachments",
      fields: {
        key: `${owner.userId}/${presigned.fileId}`,
        policy: "signed",
      },
    });
    expect(presignCalls).toEqual([
      {
        key: `${owner.userId}/${presigned.fileId}`,
        maxBytes: 1024 * 1024,
        expiresSec: 900,
      },
    ]);

    // Pending semantics: no size until complete, no extraction yet. The 24h
    // orphan sweep reclaims this if the client never finishes.
    expect(await fileRow(presigned.fileId)).toMatchObject({
      sizeBytes: 0,
      extractionStatus: "none",
      extractedText: null,
      mediaType: "text/plain",
      filename: "notes.txt",
    });
  });

  it("completes with the object's real size and cached extraction", async () => {
    const owner = await seedUser("owner");
    const presigned = await presignFile(
      { filename: "notes.txt", mediaType: "text/plain" },
      owner,
    );

    // The client posts straight to storage after the presign.
    const key = `${owner.userId}/${presigned.fileId}`;
    await getFileStorage().put(key, Buffer.from("hello direct upload"));

    const uploaded = await completeFile(presigned.fileId, owner);

    expect(uploaded).toEqual({
      id: presigned.fileId,
      url: `/api/files/${presigned.fileId}`,
      filename: "notes.txt",
      mediaType: "text/plain",
      sizeBytes: 19,
      extraction: { status: "ok", truncated: false },
    });

    const row = await fileRow(presigned.fileId);
    expect(row).toMatchObject({ sizeBytes: 19, extractionStatus: "ok" });
    expect(row.extractedText).toContain("hello direct upload");
  });

  it("404s when the direct upload never landed", async () => {
    const owner = await seedUser("owner");
    const presigned = await presignFile(
      { filename: "notes.txt", mediaType: "text/plain" },
      owner,
    );

    await expect(completeFile(presigned.fileId, owner)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      messageKey: "file.uploadFailed",
    });

    // The pending row survives for the orphan sweep rather than leaking a 500.
    expect(await fileRowCount(owner.userId)).toBe(1);
  });

  it("removes the object and the row when the real size exceeds the limit", async () => {
    const owner = await seedUser("owner");
    const presigned = await presignFile(
      { filename: "big.txt", mediaType: "text/plain" },
      owner,
    );
    const key = `${owner.userId}/${presigned.fileId}`;
    // Simulate a policy bypass: the object is bigger than maxBytes.
    await getFileStorage().put(key, Buffer.alloc(1024 * 1024 + 1));

    await expect(completeFile(presigned.fileId, owner)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.tooLarge",
      params: { limit: "1.0 MB" },
    });

    expect(await fileRowCount(owner.userId)).toBe(0);
    await expect(getFileStorage().get(key)).rejects.toThrow();
  });

  it("rejects a foreign file id as NOT_FOUND", async () => {
    const owner = await seedUser("owner");
    const other = await seedUser("other");
    const presigned = await presignFile(
      { filename: "notes.txt", mediaType: "text/plain" },
      owner,
    );
    const key = `${owner.userId}/${presigned.fileId}`;
    await getFileStorage().put(key, Buffer.from("mine"));

    await expect(completeFile(presigned.fileId, other)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      messageKey: "file.notFound",
    });
  });

  it("reclaims a stale pending row after a completion-triggered sweep", async () => {
    const owner = await seedUser("owner");

    // A presign that was abandoned: the row exists but no object ever landed.
    const abandoned = await presignFile(
      { filename: "abandoned.txt", mediaType: "text/plain" },
      owner,
    );
    await db
      .update(files)
      .set({ createdAt: new Date(Date.now() - ORPHAN_FILE_TTL_MS - 60_000) })
      .where(eq(files.id, abandoned.fileId));

    // A successful direct upload. `POST /api/files/complete` fires the sweep
    // after this returns; the route unit test asserts the wiring.
    const good = await presignFile(
      { filename: "good.txt", mediaType: "text/plain" },
      owner,
    );
    await getFileStorage().put(
      `${owner.userId}/${good.fileId}`,
      Buffer.from("ok"),
    );
    await completeFile(good.fileId, owner);

    await sweepOrphanFiles(owner);

    const remaining = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.userId, owner.userId));
    expect(remaining.map((row) => row.id)).toEqual([good.fileId]);
  });

  it("keeps a just-presigned pending row through the sweep", async () => {
    const owner = await seedUser("owner");
    const fresh = await presignFile(
      { filename: "fresh.txt", mediaType: "text/plain" },
      owner,
    );

    await sweepOrphanFiles(owner);

    // Sweeping on presign must not reclaim the row presign just inserted —
    // only rows older than the 24h TTL are candidates.
    const remaining = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.userId, owner.userId));
    expect(remaining.map((row) => row.id)).toEqual([fresh.fileId]);
  });

  it("rejects an unsupported type before creating a row or signing", async () => {
    const owner = await seedUser("owner");

    await expect(
      presignFile(
        { filename: "archive.zip", mediaType: "application/zip" },
        owner,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.unsupportedType",
    });

    expect(await fileRowCount(owner.userId)).toBe(0);
    expect(presignCalls).toHaveLength(0);
  });
});
