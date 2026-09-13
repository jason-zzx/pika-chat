import { beforeEach, describe, expect, it, vi } from "vitest";

import { PDF_MEDIA_TYPE } from "@/lib/files/media-types";
import type { FileRecord } from "@/server/files/file.service";

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  storageGet: vi.fn(),
  dbSelect: vi.fn<() => Promise<Array<{ at: Date | null }>>>(),
  dbUpdate: vi.fn<(table: unknown, values: Record<string, unknown>) => void>(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, uploadFile: mocks.uploadFile };
});

vi.mock("@/server/files/storage", () => ({
  getFileStorage: () => ({ get: mocks.storageGet }),
}));

vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.dbSelect }) }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        mocks.dbUpdate(table, values);
        return { where: async () => [] };
      },
    }),
  }),
}));

import { AISDKError, APICallError } from "ai";

import {
  createFilesApi,
  type FilesApiProvider,
} from "@/server/ai/provider-factory";
import { ensureProviderReference } from "@/server/ai/provider-files";
import { files, providerConfigs } from "@/server/db/schema";

const CONFIG_ID = "cfg-1";

/** A real provider instance — `uploadFile` is mocked, nothing is contacted. */
function googleApi(): FilesApiProvider {
  const api = createFilesApi({
    apiFormat: "google",
    name: "google",
    baseUrl: "https://example.test/v1beta",
    apiKey: "key",
  });
  if (api === null) {
    throw new Error("expected google to expose a files api");
  }
  return api;
}

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "file-1",
    userId: "user-1",
    filename: "report.pdf",
    mediaType: PDF_MEDIA_TYPE,
    sizeBytes: 3,
    storageKey: "user-1/file-1",
    extractedText: "hello",
    extractionStatus: "ok",
    extractionTruncated: false,
    providerReferences: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** jsonb is not validated by the driver, so a bad row is a real possibility. */
function malformedReferences(json: string): FileRecord["providerReferences"] {
  return JSON.parse(json);
}

function uploaded(result: {
  providerReference: Record<string, string>;
  providerMetadata?: Record<string, Record<string, string>>;
}): void {
  mocks.uploadFile.mockResolvedValue({ warnings: [], ...result });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Chunks of a drizzle `sql` template, for asserting the jsonb merge. */
function sqlChunks(table: unknown): unknown[] {
  for (const call of mocks.dbUpdate.mock.calls) {
    if (call[0] !== table || !isRecord(call[1])) {
      continue;
    }
    const chunks = call[1].providerReferences;
    if (isRecord(chunks) && Array.isArray(chunks.queryChunks)) {
      return chunks.queryChunks;
    }
  }
  return [];
}

/** The record just written for `CONFIG_ID`. */
function writtenRecord(): Record<string, unknown> {
  const json = sqlChunks(files).find(
    (chunk): chunk is string => typeof chunk === "string" && chunk.startsWith("{"),
  );
  const parsed: unknown = JSON.parse(json ?? "{}");
  const entry = isRecord(parsed) ? parsed[CONFIG_ID] : undefined;
  if (!isRecord(entry)) {
    throw new Error(`no reference record written for ${CONFIG_ID}`);
  }
  return entry;
}

function updateCount(table: unknown): number {
  return mocks.dbUpdate.mock.calls.filter((call) => call[0] === table).length;
}

beforeEach(() => {
  mocks.uploadFile.mockReset();
  mocks.storageGet.mockReset();
  mocks.dbSelect.mockReset();
  mocks.dbUpdate.mockReset();
  mocks.dbSelect.mockResolvedValue([{ at: null }]);
  mocks.storageGet.mockResolvedValue(Buffer.from("pdf"));
});

describe("ensureProviderReference", () => {
  it("uploads on the send path and returns the reference", async () => {
    uploaded({
      providerReference: { google: "files/abc" },
      providerMetadata: {
        google: { expirationTime: "2026-02-01T00:00:00.000Z" },
      },
    });

    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({
      kind: "reference",
      reference: { google: "files/abc" },
    });
    expect(mocks.storageGet).toHaveBeenCalledWith("user-1/file-1");
  });

  it("persists the reference under its config id, merging with the stored json", async () => {
    uploaded({ providerReference: { google: "files/abc" } });

    await ensureProviderReference({
      file: makeFile({
        providerReferences: {
          "other-cfg": {
            reference: { anthropic: "file_other" },
            uploadedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: null,
          },
        },
      }),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    // `existing || new`: the column is the merge base and only this config's
    // key is written, so the other config's entry survives.
    expect(sqlChunks(files)).toContain(files.providerReferences);
    expect(writtenRecord()).toEqual({
      reference: { google: "files/abc" },
      uploadedAt: expect.any(String),
      expiresAt: expect.any(String),
    });
  });

  it("takes the expiry the SDK reports", async () => {
    uploaded({
      providerReference: { google: "files/abc" },
      providerMetadata: {
        google: { expirationTime: "2026-02-01T00:00:00.000Z" },
      },
    });

    await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(writtenRecord().expiresAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("falls back to uploadedAt + 48h when the SDK reports no expiry", async () => {
    uploaded({ providerReference: { google: "files/abc" } });

    await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    const record = writtenRecord();
    expect(typeof record.uploadedAt).toBe("string");
    expect(
      Date.parse(String(record.expiresAt)) - Date.parse(String(record.uploadedAt)),
    ).toBe(48 * 60 * 60 * 1000);
  });

  it("never expires a claude reference", async () => {
    uploaded({ providerReference: { anthropic: "file_abc" } });

    await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "claude",
      filesApi: googleApi(),
    });

    expect(writtenRecord().expiresAt).toBeNull();
  });

  it("reuses a reference that is still comfortably valid", async () => {
    const file = makeFile({
      providerReferences: {
        [CONFIG_ID]: {
          reference: { google: "files/cached" },
          uploadedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        },
      },
    });

    const result = await ensureProviderReference({
      file,
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({
      kind: "reference",
      reference: { google: "files/cached" },
    });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.storageGet).not.toHaveBeenCalled();
  });

  it("re-uploads an expired reference", async () => {
    uploaded({ providerReference: { google: "files/fresh" } });
    const file = makeFile({
      providerReferences: {
        [CONFIG_ID]: {
          reference: { google: "files/stale" },
          uploadedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    });

    const result = await ensureProviderReference({
      file,
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({
      kind: "reference",
      reference: { google: "files/fresh" },
    });
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("re-uploads a reference inside the 30 minute safety margin", async () => {
    uploaded({ providerReference: { google: "files/fresh" } });
    const file = makeFile({
      providerReferences: {
        [CONFIG_ID]: {
          reference: { google: "files/stale" },
          uploadedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      },
    });

    await ensureProviderReference({
      file,
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("re-uploads when the stored record is malformed", async () => {
    uploaded({ providerReference: { google: "files/fresh" } });
    // A non-string reference value (or a missing `uploadedAt`) must read as
    // "no reference" rather than reach the model as an unroutable part.
    const file = makeFile({
      providerReferences: malformedReferences(
        `{"${CONFIG_ID}": {"reference": {"google": 42}, "uploadedAt": "2026-01-01T00:00:00.000Z"}}`,
      ),
    });

    const result = await ensureProviderReference({
      file,
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({
      kind: "reference",
      reference: { google: "files/fresh" },
    });
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("uploads for a config whose key is absent even when another has one", async () => {
    uploaded({ providerReference: { google: "files/abc" } });
    const file = makeFile({
      providerReferences: {
        "other-cfg": {
          reference: { google: "files/other" },
          uploadedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: null,
        },
      },
    });

    const result = await ensureProviderReference({
      file,
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({
      kind: "reference",
      reference: { google: "files/abc" },
    });
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("short-circuits to a fallback for a negative-cached config", async () => {
    mocks.dbSelect.mockResolvedValue([{ at: new Date() }]);

    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({ kind: "fallback" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("writes the negative cache on a permanent APICallError", async () => {
    mocks.uploadFile.mockRejectedValue(
      new APICallError({
        message: "Not Found",
        url: "https://example.test/v1/files",
        requestBodyValues: {},
        statusCode: 404,
      }),
    );

    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "claude",
      filesApi: googleApi(),
    });

    expect(result).toEqual({ kind: "fallback" });
    expect(updateCount(providerConfigs)).toBe(1);
  });

  it("writes the negative cache on google's message-embedded 404", async () => {
    // Google's files implementation raises a plain AISDKError whose message
    // carries the status — there is no `statusCode` field to read.
    mocks.uploadFile.mockRejectedValue(
      new AISDKError({
        name: "GOOGLE_FILES_UPLOAD_ERROR",
        message: "Failed to initiate resumable upload: 404 {}",
      }),
    );

    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({ kind: "fallback" });
    expect(updateCount(providerConfigs)).toBe(1);
  });

  it("does not write the negative cache on a transient 5xx", async () => {
    mocks.uploadFile.mockRejectedValue(
      new APICallError({
        message: "Internal Server Error",
        url: "https://example.test/v1/files",
        requestBodyValues: {},
        statusCode: 500,
      }),
    );

    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "claude",
      filesApi: googleApi(),
    });

    expect(result).toEqual({ kind: "fallback" });
    expect(updateCount(providerConfigs)).toBe(0);
  });

  it("does not write the negative cache on a 429", async () => {
    mocks.uploadFile.mockRejectedValue(
      new APICallError({
        message: "Too Many Requests",
        url: "https://example.test/v1/files",
        requestBodyValues: {},
        statusCode: 429,
      }),
    );

    await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "claude",
      filesApi: googleApi(),
    });

    expect(updateCount(providerConfigs)).toBe(0);
  });

  it("does not write the negative cache on a network failure", async () => {
    // Google's upload path lets a raw fetch failure through untouched.
    mocks.uploadFile.mockRejectedValue(new TypeError("fetch failed"));

    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({ kind: "fallback" });
    expect(updateCount(providerConfigs)).toBe(0);
  });

  it("does not read a port in a connect error as an http status", async () => {
    // A connect/timeout failure carries the address: `attempted address:
    // 10.0.0.1:404`. That 404 is a port, not a status — treating it as one
    // would negative-cache a config that never answered at all.
    mocks.uploadFile.mockRejectedValue(
      new TypeError(
        "fetch failed (attempted address: 10.0.0.1:404, timeout: 30000ms)",
      ),
    );

    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({ kind: "fallback" });
    expect(updateCount(providerConfigs)).toBe(0);
  });

  it("does not write the negative cache when google reports a 5xx in its message", async () => {
    mocks.uploadFile.mockRejectedValue(
      new AISDKError({
        name: "GOOGLE_FILES_UPLOAD_ERROR",
        message: "Failed to upload file data: 503 {}",
      }),
    );

    await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(updateCount(providerConfigs)).toBe(0);
  });

  it("falls back without uploading when the format has no files api", async () => {
    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "openai-compatible",
      filesApi: null,
    });

    expect(result).toEqual({ kind: "fallback" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it("degrades to a fallback when the stored bytes cannot be read", async () => {
    mocks.storageGet.mockRejectedValue(new Error("missing object"));

    const result = await ensureProviderReference({
      file: makeFile(),
      configId: CONFIG_ID,
      apiFormat: "google",
      filesApi: googleApi(),
    });

    expect(result).toEqual({ kind: "fallback" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });
});
