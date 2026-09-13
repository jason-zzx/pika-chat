import "server-only";

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib/id";
import { encryptSecret } from "@/server/crypto";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  accounts,
  assistants,
  chatMessages,
  files,
  providerConfigs,
  providerFileDeleteRetries,
  providerModels,
  sessions,
  topics,
  users,
  verifications,
  type ProviderFileReference,
} from "@/server/db/schema";

// Set before the first `getEnv()` call so the storage singleton writes into a
// throwaway directory.
const storageRoot = join(tmpdir(), `pika-provider-delete-it-${process.pid}-${newId()}`);
process.env.FILE_STORAGE_DIR = storageRoot;

import {
  deleteFile,
  ORPHAN_FILE_TTL_MS,
  deleteFilesIfUnreferenced,
  sweepOrphanFiles,
} from "./file.service";
import { MAX_DELETE_ATTEMPTS, processDeleteRetries } from "./provider-delete";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(providerFileDeleteRetries);
  await db.delete(providerModels);
  await db.delete(files);
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(providerConfigs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
}

async function seedUser(label: string): Promise<Actor & { id: string }> {
  const id = newId();
  await db.insert(users).values({
    id,
    name: label,
    email: `${label}-${id}@example.com`,
    username: `${label}-${id}`,
  });
  return { userId: id, role: "user", id };
}

async function seedClaudeConfig(ownerId: string): Promise<string> {
  const id = newId();
  await db.insert(providerConfigs).values({
    id,
    ownerId,
    name: `claude-${id}`,
    baseUrl: "https://api.anthropic.com/v1",
    apiFormat: "claude",
    encryptedApiKey: encryptSecret("sk-ant-test"),
    apiKeyLastFour: "test",
  });
  return id;
}

function claudeReference(providerConfigId: string): ProviderFileReference {
  return {
    reference: { anthropic: `file_${providerConfigId}` },
    uploadedAt: new Date().toISOString(),
    expiresAt: null,
  };
}

function googleReference(): ProviderFileReference {
  return {
    reference: { google: "files/xyz" },
    uploadedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  };
}

async function seedFile(
  ownerId: string,
  providerReferences: Record<string, ProviderFileReference>,
  options: { createdAt?: Date } = {},
): Promise<{ id: string; storageKey: string }> {
  const id = newId();
  const storageKey = `${ownerId}/${id}`;
  await db.insert(files).values({
    id,
    userId: ownerId,
    filename: "clip.mp4",
    mediaType: "video/mp4",
    sizeBytes: 8,
    storageKey,
    providerReferences,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  });
  return { id, storageKey };
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(status: number): void {
  fetchMock.mockResolvedValue(new Response(null, { status }));
}

const DELETE_URL_RE = /\/files\/file_/;

beforeEach(async () => {
  await resetState();
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetState();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("provider deletion linked to local deletion", () => {
  it("deletes the provider file when deleteFile removes the row", async () => {
    const owner = await seedUser("owner");
    const configId = await seedClaudeConfig(owner.userId);
    const file = await seedFile(owner.userId, {
      [configId]: claudeReference(configId),
    });

    await deleteFile(file.id, owner);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(DELETE_URL_RE);
    expect(init.method).toBe("DELETE");
    const rows = await db
      .select({ id: providerFileDeleteRetries.id })
      .from(providerFileDeleteRetries);
    expect(rows).toHaveLength(0);
  });

  it("deletes the provider file from deleteFilesIfUnreferenced", async () => {
    const owner = await seedUser("owner");
    const configId = await seedClaudeConfig(owner.userId);
    const file = await seedFile(owner.userId, {
      [configId]: claudeReference(configId),
    });

    await deleteFilesIfUnreferenced([file.id], owner);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const remaining = await db.select({ id: files.id }).from(files);
    expect(remaining).toHaveLength(0);
  });

  it("deletes the provider file from the orphan sweep", async () => {
    const owner = await seedUser("owner");
    const configId = await seedClaudeConfig(owner.userId);
    await seedFile(
      owner.userId,
      { [configId]: claudeReference(configId) },
      { createdAt: new Date(Date.now() - ORPHAN_FILE_TTL_MS - 60_000) },
    );

    await sweepOrphanFiles(owner);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const remaining = await db.select({ id: files.id }).from(files);
    expect(remaining).toHaveLength(0);
  });

  it("never calls the provider for a reference that expires on its own", async () => {
    const owner = await seedUser("owner");
    const file = await seedFile(owner.userId, {
      "cfg-google": googleReference(),
    });

    await deleteFile(file.id, owner);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("retry queue drained by the sweep", () => {
  async function seedRetry(
    providerConfigId: string,
    attempts: number,
  ): Promise<string> {
    const id = newId();
    await db.insert(providerFileDeleteRetries).values({
      id,
      providerConfigId,
      providerFileId: `file_retry_${id}`,
      attempts,
      nextRetryAt: new Date(Date.now() - 1000),
      lastStatus: null,
    });
    return id;
  }

  it("deletes a due entry at the provider and drops it from the queue", async () => {
    const owner = await seedUser("owner");
    const configId = await seedClaudeConfig(owner.userId);
    await seedRetry(configId, 1);
    stubFetch(204);

    await processDeleteRetries();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(DELETE_URL_RE);
    expect(init.method).toBe("DELETE");
    const rows = await db
      .select({ id: providerFileDeleteRetries.id })
      .from(providerFileDeleteRetries);
    expect(rows).toHaveLength(0);
  });

  it("reschedules a due entry and increments its attempt count", async () => {
    const owner = await seedUser("owner");
    const configId = await seedClaudeConfig(owner.userId);
    const retryId = await seedRetry(configId, 0);
    stubFetch(503);

    await sweepOrphanFiles(owner);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = await db
      .select()
      .from(providerFileDeleteRetries)
      .where(eq(providerFileDeleteRetries.id, retryId));
    expect(rows[0]).toMatchObject({ attempts: 1, lastStatus: 503 });
  });

  it("abandons a due entry at the attempt ceiling", async () => {
    const owner = await seedUser("owner");
    const configId = await seedClaudeConfig(owner.userId);
    await seedRetry(configId, MAX_DELETE_ATTEMPTS - 1);
    stubFetch(500);

    await sweepOrphanFiles(owner);

    const rows = await db.select({ id: providerFileDeleteRetries.id }).from(
      providerFileDeleteRetries,
    );
    expect(rows).toHaveLength(0);
  });

  it("leaves entries scheduled in the future untouched", async () => {
    const owner = await seedUser("owner");
    const configId = await seedClaudeConfig(owner.userId);
    const id = newId();
    await db.insert(providerFileDeleteRetries).values({
      id,
      providerConfigId: configId,
      providerFileId: "file_later",
      attempts: 0,
      nextRetryAt: new Date(Date.now() + 60_000),
    });

    await sweepOrphanFiles(owner);

    expect(fetchMock).not.toHaveBeenCalled();
    const rows = await db
      .select({ id: providerFileDeleteRetries.id })
      .from(providerFileDeleteRetries);
    expect(rows).toHaveLength(1);
  });

  it("drains an entry whose config was deleted, without calling the provider", async () => {
    await seedRetry("config-that-never-existed", 0);

    await processDeleteRetries();

    expect(fetchMock).not.toHaveBeenCalled();
    const rows = await db.select({ id: providerFileDeleteRetries.id }).from(
      providerFileDeleteRetries,
    );
    expect(rows).toHaveLength(0);
  });
});
