import "server-only";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const uploadFile = vi.hoisted(() => vi.fn());

// The provider upload is the network boundary; the merge itself runs against
// the real SQLite column.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, uploadFile };
});

import { newId } from "@/lib/id";
import type { ProviderApiFormat } from "@/lib/provider-format";
import { createFilesApi } from "@/server/ai/provider-factory";
import { ensureProviderReference } from "@/server/ai/provider-files";
import { getDb } from "@/server/db/client";
import { files, users, type ProviderFileReference } from "@/server/db/schema";
import { getFileStorage } from "@/server/files/storage";

const db = getDb();

afterEach(async () => {
  await db.delete(files);
  await db.delete(users);
});

function filesApi(apiFormat: ProviderApiFormat) {
  return createFilesApi({
    apiFormat,
    name: apiFormat,
    baseUrl: "https://example.test/v1",
    apiKey: "key",
  });
}

describe("provider file reference merge", () => {
  it("replaces one config's record whole and keeps every other config's record", async () => {
    const userId = newId();
    await db.insert(users).values({
      id: userId,
      name: "Owner",
      email: `${userId}@example.test`,
      username: `u_${userId.slice(0, 8)}`,
    });
    const kept: ProviderFileReference = {
      reference: { google: "files/kept" },
      uploadedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2999-01-01T00:00:00.000Z",
    };
    const fileId = newId();
    const storageKey = `${userId}/${fileId}.pdf`;
    const file = db
      .insert(files)
      .values({
        id: fileId,
        userId,
        filename: "report.pdf",
        mediaType: "application/pdf",
        sizeBytes: 3,
        storageKey,
        providerReferences: {
          "cfg-kept": kept,
          // Expired, and carrying a key the new upload does not: a deep merge
          // would keep `stale`, a whole-value replace drops it.
          "cfg-google": {
            reference: { google: "files/old", stale: "x" },
            uploadedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-01-02T00:00:00.000Z",
          },
        },
      })
      .returning()
      .get();
    await getFileStorage().put(storageKey, Buffer.from("pdf"));

    uploadFile.mockResolvedValueOnce({
      providerReference: { google: "files/new" },
      providerMetadata: { google: { expirationTime: "2999-06-01T00:00:00.000Z" } },
    });
    await ensureProviderReference({
      file,
      configId: "cfg-google",
      apiFormat: "google",
      filesApi: filesApi("google"),
    });

    uploadFile.mockResolvedValueOnce({
      providerReference: { anthropic: "file_1" },
      providerMetadata: {},
    });
    await ensureProviderReference({
      file,
      configId: "cfg-claude",
      apiFormat: "claude",
      filesApi: filesApi("claude"),
    });

    const [stored] = await db.select().from(files).where(eq(files.id, fileId));
    expect(stored?.providerReferences).toEqual({
      "cfg-kept": kept,
      "cfg-google": {
        reference: { google: "files/new" },
        uploadedAt: expect.any(String),
        expiresAt: "2999-06-01T00:00:00.000Z",
      },
      // A never-expiring record keeps its explicit null.
      "cfg-claude": {
        reference: { anthropic: "file_1" },
        uploadedAt: expect.any(String),
        expiresAt: null,
      },
    });
    await getFileStorage().delete(storageKey);
  });
});
