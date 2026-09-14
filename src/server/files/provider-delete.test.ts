import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderFileReference } from "@/server/db/schema";
import type { ProviderEndpoint } from "@/server/ai/provider-factory";

const HOUR_MS = 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  loadProviderEndpoint: vi.fn<() => Promise<ProviderEndpoint | null>>(),
  selectRows: [] as unknown[],
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  deleted: 0,
}));

vi.mock("@/server/ai/chat-model", () => ({
  loadProviderEndpoint: mocks.loadProviderEndpoint,
}));

vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// A minimal drizzle stand-in covering the three chain shapes this module uses:
// `.select().from().where()` (awaitable, and `.limit()` for the enqueue guard),
// `.insert().values()`, `.update().set().where()`, `.delete().where()`.
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          const promise = Promise.resolve(mocks.selectRows) as Promise<
            unknown[]
          > & { limit: (n: number) => Promise<unknown[]> };
          promise.limit = async () => mocks.selectRows;
          return promise;
        },
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        mocks.inserted.push(row);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mocks.updated.push(values);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        mocks.deleted += 1;
      },
    }),
  }),
}));

import {
  attemptDelete,
  deleteProviderFileReferences,
  processDeleteRetries,
  type ProviderReferencedFile,
} from "./provider-delete";

const CONFIG_ID = "cfg-claude";

function claudeEndpoint(): ProviderEndpoint {
  return {
    apiFormat: "claude",
    name: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "sk-ant-test",
  };
}

function googleEndpoint(): ProviderEndpoint {
  return {
    apiFormat: "google",
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "key",
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetchResponse(status: number): void {
  fetchMock.mockResolvedValue(new Response(null, { status }));
}

function reference(
  overrides: Partial<ProviderFileReference> = {},
): ProviderFileReference {
  return {
    reference: { anthropic: "file_abc" },
    uploadedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    ...overrides,
  };
}

function referencedFile(
  providerReferences: Record<string, ProviderFileReference>,
): ProviderReferencedFile {
  return { id: "file-local-1", providerReferences };
}

/** The `init` argument of the most recent fetch call. */
function lastInit(): RequestInit {
  const call = fetchMock.mock.calls.at(-1);
  return (call?.[1] ?? {}) as RequestInit;
}

beforeEach(() => {
  mocks.loadProviderEndpoint.mockReset();
  mocks.selectRows = [];
  mocks.inserted = [];
  mocks.updated = [];
  mocks.deleted = 0;
  mocks.loadProviderEndpoint.mockResolvedValue(claudeEndpoint());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("attemptDelete", () => {
  it.each([200, 202, 204, 404])("resolves on HTTP %i", async (status) => {
    stubFetchResponse(status);
    await expect(attemptDelete(CONFIG_ID, "file_abc")).resolves.toEqual({
      kind: "resolved",
    });
  });

  it.each([401, 403])("abandons on credentials failure HTTP %i", async (status) => {
    stubFetchResponse(status);
    await expect(attemptDelete(CONFIG_ID, "file_abc")).resolves.toEqual({
      kind: "abandoned",
      status,
      reason: "credentials",
    });
  });

  it.each([429, 500, 503])("retries on transient HTTP %i", async (status) => {
    stubFetchResponse(status);
    await expect(attemptDelete(CONFIG_ID, "file_abc")).resolves.toEqual({
      kind: "retry",
      status,
    });
  });

  it("retries when the request never completes", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(attemptDelete(CONFIG_ID, "file_abc")).resolves.toEqual({
      kind: "retry",
      status: null,
    });
  });

  it("sends the Anthropic DELETE contract", async () => {
    stubFetchResponse(204);
    await attemptDelete(CONFIG_ID, "file_abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.anthropic.com/v1/files/file_abc",
    );
    expect(lastInit().method).toBe("DELETE");
    expect(lastInit().headers).toEqual({
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    });
  });

  it("abandons when the config is gone, without calling the provider", async () => {
    mocks.loadProviderEndpoint.mockResolvedValue(null);
    await expect(attemptDelete(CONFIG_ID, "file_abc")).resolves.toEqual({
      kind: "abandoned",
      status: null,
      reason: "configMissing",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("abandons when the config no longer speaks Claude", async () => {
    mocks.loadProviderEndpoint.mockResolvedValue(googleEndpoint());
    await expect(attemptDelete(CONFIG_ID, "file_abc")).resolves.toEqual({
      kind: "abandoned",
      status: null,
      reason: "formatChanged",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("abandons when the key cannot be decrypted", async () => {
    mocks.loadProviderEndpoint.mockRejectedValue(new Error("bad envelope"));
    await expect(attemptDelete(CONFIG_ID, "file_abc")).resolves.toEqual({
      kind: "abandoned",
      status: null,
      reason: "configMissing",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deleteProviderFileReferences", () => {
  it("skips references that expire on their own", async () => {
    stubFetchResponse(204);
    const google = reference({
      reference: { google: "files/xyz" },
      expiresAt: "2026-01-03T00:00:00.000Z",
    });
    await deleteProviderFileReferences(referencedFile({ [CONFIG_ID]: google }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.inserted).toHaveLength(0);
  });

  it("deletes a Claude reference and leaves it at that", async () => {
    stubFetchResponse(204);
    await deleteProviderFileReferences(
      referencedFile({ [CONFIG_ID]: reference() }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.updated).toHaveLength(0);
  });

  it("queues a transient failure with the first backoff", async () => {
    stubFetchResponse(429);
    const before = Date.now();
    await deleteProviderFileReferences(
      referencedFile({ [CONFIG_ID]: reference() }),
    );

    expect(mocks.inserted).toHaveLength(1);
    const row = mocks.inserted[0];
    expect(row).toMatchObject({
      providerConfigId: CONFIG_ID,
      providerFileId: "file_abc",
      attempts: 0,
      lastStatus: 429,
    });
    const nextRetryAt = row?.nextRetryAt as Date;
    expect(nextRetryAt.getTime()).toBeGreaterThanOrEqual(before + HOUR_MS);
    expect(nextRetryAt.getTime()).toBeLessThan(Date.now() + HOUR_MS + 60_000);
  });

  it("does not duplicate an already queued provider file", async () => {
    stubFetchResponse(500);
    mocks.selectRows = [{ id: "retry-1" }];
    await deleteProviderFileReferences(
      referencedFile({ [CONFIG_ID]: reference() }),
    );
    expect(mocks.inserted).toHaveLength(0);
  });

  it("ignores a malformed record instead of throwing", async () => {
    await deleteProviderFileReferences(
      referencedFile({
        [CONFIG_ID]: { reference: {}, uploadedAt: "", expiresAt: null },
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a non-expiring reference without an Anthropic file id", async () => {
    await deleteProviderFileReferences(
      referencedFile({
        [CONFIG_ID]: reference({ reference: { mystery: "id" } }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles an empty reference map", async () => {
    await deleteProviderFileReferences(referencedFile({}));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("processDeleteRetries", () => {
  it("reschedules a transient failure with the next backoff", async () => {
    stubFetchResponse(503);
    mocks.selectRows = [
      {
        id: "retry-1",
        providerConfigId: CONFIG_ID,
        providerFileId: "file_abc",
        attempts: 0,
        nextRetryAt: new Date(),
        lastStatus: null,
        createdAt: new Date(),
      },
    ];
    const before = Date.now();
    await processDeleteRetries();

    expect(mocks.updated).toHaveLength(1);
    expect(mocks.updated[0]).toMatchObject({ attempts: 1, lastStatus: 503 });
    const nextRetryAt = mocks.updated[0]?.nextRetryAt as Date;
    expect(nextRetryAt.getTime()).toBeGreaterThanOrEqual(before + 4 * HOUR_MS);
    expect(mocks.deleted).toBe(0);
  });
});
