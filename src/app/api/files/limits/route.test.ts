import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActor, maxFileBytes, isS3DirectAccessEnabled, usageBytes, effectiveQuotaBytes } =
  vi.hoisted(() => ({
    requireActor: vi.fn(),
    maxFileBytes: vi.fn(),
    isS3DirectAccessEnabled: vi.fn(),
    usageBytes: vi.fn(),
    effectiveQuotaBytes: vi.fn(),
  }));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/files/limits", () => ({ maxFileBytes, isS3DirectAccessEnabled }));
vi.mock("@/server/files/quota", () => ({ usageBytes, effectiveQuotaBytes }));

import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/files/constants";
import { fileLimitsSchema } from "@/lib/schemas/file";

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue({ userId: "user-1", role: "user" });
  maxFileBytes.mockReturnValue(50 * 1024 * 1024);
  isS3DirectAccessEnabled.mockReturnValue(true);
  usageBytes.mockResolvedValue(1024);
  effectiveQuotaBytes.mockResolvedValue(5 * 1024 * 1024 * 1024);
});

describe("GET /api/files/limits", () => {
  it("returns the resolved upload limits and quota", async () => {
    const response = await GET(
      new Request("http://test/api/files/limits"),
      undefined,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      maxFileBytes: 50 * 1024 * 1024,
      maxAttachmentsPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
      directUpload: true,
      usedBytes: 1024,
      quotaBytes: 5 * 1024 * 1024 * 1024,
    });
    expect(usageBytes).toHaveBeenCalledWith("user-1");
  });

  it("reports an unlimited quota as null", async () => {
    effectiveQuotaBytes.mockResolvedValue(null);
    const response = await GET(
      new Request("http://test/api/files/limits"),
      undefined,
    );
    await expect(response.json()).resolves.toMatchObject({ quotaBytes: null });
  });

  it("accepts a zero quota through the client response schema", async () => {
    // An admin may legitimately cap a user at 0 bytes; the response must stay
    // parseable or the client silently falls back to "unlimited".
    effectiveQuotaBytes.mockResolvedValue(0);
    const response = await GET(
      new Request("http://test/api/files/limits"),
      undefined,
    );
    const parsed = fileLimitsSchema.parse(await response.json());
    expect(parsed.quotaBytes).toBe(0);
  });
});
