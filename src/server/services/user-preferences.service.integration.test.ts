import "server-only";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

import {
  getUserThemePreference,
  updateUserThemePreference,
} from "./user-preferences.service";

const db = getDb();
const created: string[] = [];

async function seedUser() {
  const id = newId();
  await db.insert(users).values({
    id,
    name: `user-${id}`,
    email: `${id}@example.com`,
    username: id,
  });
  created.push(id);
  return id;
}

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("getUserThemePreference", () => {
  it("returns the column defaults for a fresh user", async () => {
    const userId = await seedUser();

    await expect(getUserThemePreference(userId)).resolves.toEqual({
      mode: "system",
      preset: "default",
    });
  });

  it("404s for a missing user", async () => {
    await expect(getUserThemePreference(newId())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      messageKey: "auth.userNotFound",
    });
  });
});

describe("updateUserThemePreference", () => {
  it("updates both fields and returns the stored preference", async () => {
    const userId = await seedUser();

    const result = await updateUserThemePreference(userId, {
      themeMode: "dark",
      themePreset: "ocean",
    });

    expect(result).toEqual({ mode: "dark", preset: "ocean" });
    await expect(getUserThemePreference(userId)).resolves.toEqual({
      mode: "dark",
      preset: "ocean",
    });
  });

  it("applies successive full updates", async () => {
    const userId = await seedUser();
    await updateUserThemePreference(userId, {
      themeMode: "light",
      themePreset: "paper",
    });

    const result = await updateUserThemePreference(userId, {
      themeMode: "dark",
      themePreset: "forest",
    });

    expect(result).toEqual({ mode: "dark", preset: "forest" });
    await expect(getUserThemePreference(userId)).resolves.toEqual({
      mode: "dark",
      preset: "forest",
    });
  });

  it("404s for a missing user", async () => {
    await expect(
      updateUserThemePreference(newId(), {
        themeMode: "dark",
        themePreset: "default",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      messageKey: "auth.userNotFound",
    });
  });
});
