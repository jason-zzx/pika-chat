import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

const { requireActor, updateUserThemePreference } = vi.hoisted(() => ({
  requireActor: vi.fn(),
  updateUserThemePreference: vi.fn(),
}));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/services/user-preferences.service", () => ({
  updateUserThemePreference,
}));

import { PATCH } from "./route";

const actor = { userId: "u1", role: "user" as const, name: "User" };

function patchRequest(body: unknown): Request {
  return new Request("http://test/api/account/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(actor);
});

describe("PATCH /api/account/preferences", () => {
  it("updates the preference for the signed-in user", async () => {
    updateUserThemePreference.mockResolvedValue({
      mode: "dark",
      preset: "ocean",
    });
    const response = await PATCH(
      patchRequest({ themeMode: "dark", themePreset: "ocean" }),
    );
    expect(response.status).toBe(200);
    expect(updateUserThemePreference).toHaveBeenCalledWith("u1", {
      themeMode: "dark",
      themePreset: "ocean",
    });
    await expect(response.json()).resolves.toEqual({
      themeMode: "dark",
      themePreset: "ocean",
    });
  });

  it("400s on an invalid mode", async () => {
    const response = await PATCH(patchRequest({ themeMode: "neon" }));
    expect(response.status).toBe(400);
    expect(updateUserThemePreference).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });

  it("400s on an invalid preset", async () => {
    const response = await PATCH(patchRequest({ themePreset: "neon" }));
    expect(response.status).toBe(400);
    expect(updateUserThemePreference).not.toHaveBeenCalled();
  });

  it("400s on an empty patch", async () => {
    const response = await PATCH(patchRequest({}));
    expect(response.status).toBe(400);
    expect(updateUserThemePreference).not.toHaveBeenCalled();
  });

  it("401s when unauthenticated", async () => {
    requireActor.mockRejectedValue(
      new AppError("UNAUTHENTICATED", 401, "auth.required"),
    );
    const response = await PATCH(
      patchRequest({ themeMode: "dark", themePreset: "default" }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED", messageKey: "auth.required" },
    });
  });
});
