import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

const { requireAdmin, getUserQuota, updateUserQuota } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getUserQuota: vi.fn(),
  updateUserQuota: vi.fn(),
}));

vi.mock("@/server/auth/actor", () => ({ requireAdmin }));
vi.mock("@/server/services/user-quota.service", () => ({
  getUserQuota,
  updateUserQuota,
}));

import { GET, PATCH } from "./route";

const actor = { userId: "admin-1", role: "admin" as const };

function context(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

function patchRequest(body: unknown): Request {
  return new Request("http://test/api/admin/users/u1/quota", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(actor);
});

describe("GET /api/admin/users/[userId]/quota", () => {
  it("returns the user's override", async () => {
    getUserQuota.mockResolvedValue({ userId: "u1", quotaBytes: 512 * 1024 * 1024 });
    const response = await GET(
      new Request("http://test/api/admin/users/u1/quota"),
      context("u1"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: "u1",
      quotaBytes: 512 * 1024 * 1024,
    });
  });

  it("404s for a missing target", async () => {
    getUserQuota.mockRejectedValue(
      new AppError("NOT_FOUND", 404, "auth.userNotFound"),
    );
    const response = await GET(
      new Request("http://test/api/admin/users/nope/quota"),
      context("nope"),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", messageKey: "auth.userNotFound" },
    });
  });

  it("403s for a non-admin", async () => {
    requireAdmin.mockRejectedValue(
      new AppError("FORBIDDEN", 403, "auth.adminRequired"),
    );
    const response = await GET(
      new Request("http://test/api/admin/users/u1/quota"),
      context("u1"),
    );
    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/admin/users/[userId]/quota", () => {
  it("sets an override in MB", async () => {
    updateUserQuota.mockResolvedValue({
      userId: "u1",
      quotaBytes: 512 * 1024 * 1024,
    });
    const response = await PATCH(patchRequest({ quotaMb: 512 }), context("u1"));
    expect(response.status).toBe(200);
    expect(updateUserQuota).toHaveBeenCalledWith("u1", 512, actor);
  });

  it("clears the override with null", async () => {
    updateUserQuota.mockResolvedValue({ userId: "u1", quotaBytes: null });
    const response = await PATCH(patchRequest({ quotaMb: null }), context("u1"));
    expect(response.status).toBe(200);
    expect(updateUserQuota).toHaveBeenCalledWith("u1", null, actor);
    await expect(response.json()).resolves.toEqual({
      userId: "u1",
      quotaBytes: null,
    });
  });

  it("400s on a negative quota", async () => {
    const response = await PATCH(patchRequest({ quotaMb: -1 }), context("u1"));
    expect(response.status).toBe(400);
    expect(updateUserQuota).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });
});
