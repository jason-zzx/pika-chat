import "server-only";

import { eq } from "drizzle-orm";

import type { ThemePreferencesRequest } from "@/lib/schemas/theme-preferences";
import {
  parseThemeMode,
  parseThemePreset,
  type ThemePreference,
} from "@/lib/theme";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AppError } from "@/server/errors";

/**
 * Reads one user's theme preference. The DB is the single source of truth for
 * signed-in users (the cookie only covers anonymous pages and the system-mode
 * resolved hint). Column values are re-validated on read so a manually edited
 * or future-removed value degrades to defaults instead of breaking SSR.
 */
export async function getUserThemePreference(
  userId: string,
): Promise<ThemePreference> {
  const row = (
    await getDb()
      .select({ themeMode: users.themeMode, themePreset: users.themePreset })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  return {
    mode: parseThemeMode(row.themeMode),
    preset: parseThemePreset(row.themePreset),
  };
}

/**
 * Self-service theme preference update for the signed-in user. The input is
 * the full preference, already zod-validated at the route boundary.
 */
export async function updateUserThemePreference(
  userId: string,
  input: ThemePreferencesRequest,
): Promise<ThemePreference> {
  const updated = await getDb()
    .update(users)
    .set({
      themeMode: input.themeMode,
      themePreset: input.themePreset,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!updated[0]) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  return { mode: input.themeMode, preset: input.themePreset };
}
