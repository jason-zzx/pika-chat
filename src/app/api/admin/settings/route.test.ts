import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_QUOTA_MB } from "@/lib/files/constants";
import { AppError } from "@/server/errors";

const { requireAdmin, getInstanceSettings, updateInstanceSettings } =
  vi.hoisted(() => ({
    requireAdmin: vi.fn(),
    getInstanceSettings: vi.fn(),
    updateInstanceSettings: vi.fn(),
  }));

vi.mock("@/server/auth/actor", () => ({ requireAdmin }));
vi.mock("@/server/services/instance-settings.service", () => ({
  getInstanceSettings,
  updateInstanceSettings,
}));

import { GET, PATCH } from "./route";

const actor = { userId: "admin-1", role: "admin" as const };

function patchRequest(body: unknown): Request {
  return new Request("http://test/api/admin/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(actor);
});

describe("GET /api/admin/settings", () => {
  it("returns the full instance settings", async () => {
    getInstanceSettings.mockResolvedValue({
      allowRegistration: true,
      fileStorageQuotaMb: 5120,
    });
    const response = await GET(
      new Request("http://test/api/admin/settings"),
      undefined,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      allowRegistration: true,
      fileStorageQuotaMb: 5120,
    });
  });

  it("403s for a non-admin", async () => {
    requireAdmin.mockRejectedValue(
      new AppError("FORBIDDEN", 403, "auth.adminRequired"),
    );
    const response = await GET(
      new Request("http://test/api/admin/settings"),
      undefined,
    );
    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/admin/settings", () => {
  it("updates the global storage quota", async () => {
    updateInstanceSettings.mockResolvedValue({
      allowRegistration: false,
      fileStorageQuotaMb: 100,
    });
    const response = await PATCH(
      patchRequest({ fileStorageQuotaMb: 100 }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(updateInstanceSettings).toHaveBeenCalledWith(
      { fileStorageQuotaMb: 100 },
      actor,
    );
  });

  it("accepts null as unlimited", async () => {
    updateInstanceSettings.mockResolvedValue({
      allowRegistration: false,
      fileStorageQuotaMb: null,
    });
    const response = await PATCH(
      patchRequest({ fileStorageQuotaMb: null }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(updateInstanceSettings).toHaveBeenCalledWith(
      { fileStorageQuotaMb: null },
      actor,
    );
  });

  it("400s on a negative quota", async () => {
    const response = await PATCH(
      patchRequest({ fileStorageQuotaMb: -5 }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(updateInstanceSettings).not.toHaveBeenCalled();
  });

  it("accepts the largest safe quota and rejects one above it", async () => {
    updateInstanceSettings.mockResolvedValue({
      allowRegistration: false,
      fileStorageQuotaMb: MAX_QUOTA_MB,
    });
    const ok = await PATCH(
      patchRequest({ fileStorageQuotaMb: MAX_QUOTA_MB }),
      undefined,
    );
    expect(ok.status).toBe(200);

    const tooLarge = await PATCH(
      patchRequest({ fileStorageQuotaMb: MAX_QUOTA_MB + 1 }),
      undefined,
    );
    expect(tooLarge.status).toBe(400);
    expect(updateInstanceSettings).toHaveBeenCalledTimes(1);
  });
});
