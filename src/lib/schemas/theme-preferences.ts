import { z } from "zod";

import { THEME_PRESETS } from "@/lib/theme";

/** PATCH body for `/api/account/preferences` — always the full preference. */
export const themePreferencesRequestSchema = z.object({
  themeMode: z.enum(["light", "dark", "system"]),
  themePreset: z.enum(THEME_PRESETS),
});

export type ThemePreferencesRequest = z.infer<
  typeof themePreferencesRequestSchema
>;
