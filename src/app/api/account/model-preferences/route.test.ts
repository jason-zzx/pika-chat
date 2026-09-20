import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

const { requireActor, getModelPreferences, updateModelPreferences } =
  vi.hoisted(() => ({
    requireActor: vi.fn(),
    getModelPreferences: vi.fn(),
    updateModelPreferences: vi.fn(),
  }));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/services/model-preferences.service", () => ({
  getModelPreferences,
  updateModelPreferences,
}));

import { GET, PATCH } from "./route";

const actor = { userId: "u1", role: "user" as const, name: "User" };
const pair = { providerConfigId: "cfg-1", modelId: "gpt-4o" };

function patchRequest(body: unknown): Request {
  return new Request("http://test/api/account/model-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(actor);
});

describe("GET /api/account/model-preferences", () => {
  it("returns the signed-in user's preferences", async () => {
    getModelPreferences.mockResolvedValue({ chat: pair });
    const response = await GET(new Request("http://test/api/account/model-preferences"));
    expect(response.status).toBe(200);
    expect(getModelPreferences).toHaveBeenCalledWith("u1");
    await expect(response.json()).resolves.toEqual({ chat: pair });
  });

  it("401s when unauthenticated", async () => {
    requireActor.mockRejectedValue(
      new AppError("UNAUTHENTICATED", 401, "auth.required"),
    );
    const response = await GET(new Request("http://test/api/account/model-preferences"));
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/account/model-preferences", () => {
  it("replaces the preference set for the signed-in user", async () => {
    updateModelPreferences.mockResolvedValue({ chat: pair });
    const response = await PATCH(patchRequest({ chat: pair, title: null }));
    expect(response.status).toBe(200);
    expect(updateModelPreferences).toHaveBeenCalledWith(
      { chat: pair, title: null },
      actor,
    );
    await expect(response.json()).resolves.toEqual({ chat: pair });
  });

  it("clears all slots on an empty object", async () => {
    updateModelPreferences.mockResolvedValue({});
    const response = await PATCH(patchRequest({}));
    expect(response.status).toBe(200);
    expect(updateModelPreferences).toHaveBeenCalledWith({}, actor);
  });

  it("400s on a malformed pair", async () => {
    const response = await PATCH(patchRequest({ chat: { modelId: "gpt-4o" } }));
    expect(response.status).toBe(400);
    expect(updateModelPreferences).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });

  it("400s when the service rejects an unavailable model", async () => {
    updateModelPreferences.mockRejectedValue(
      new AppError("VALIDATION_FAILED", 400, "model.notAvailable"),
    );
    const response = await PATCH(patchRequest({ chat: pair }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED", messageKey: "model.notAvailable" },
    });
  });

  it("401s when unauthenticated", async () => {
    requireActor.mockRejectedValue(
      new AppError("UNAUTHENTICATED", 401, "auth.required"),
    );
    const response = await PATCH(patchRequest({ chat: pair }));
    expect(response.status).toBe(401);
  });
});
