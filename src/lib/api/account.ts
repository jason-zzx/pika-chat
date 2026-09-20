import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  parseModelPreferences,
  type ModelPreferences,
} from "@/lib/schemas/model-preferences";
import type { ThemePreferencesRequest } from "@/lib/schemas/theme-preferences";

/**
 * Persists the signed-in user's theme preference. The DB is the source of
 * truth; a failure throws the parsed error envelope for
 * `apiErrorMessageFromUnknown` to resolve.
 */
export async function updateThemePreference(
  preference: ThemePreferencesRequest,
): Promise<void> {
  const response = await fetch("/api/account/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preference),
  });
  return parseEmpty(response);
}

/** Reads the signed-in user's default model preferences (four slots). */
export async function getModelPreferences(): Promise<ModelPreferences> {
  const response = await fetch("/api/account/model-preferences");
  return parseJson(response, parseModelPreferences);
}

/** Replaces the full preference set; a `null` slot clears it. */
export async function updateModelPreferences(
  preferences: ModelPreferences,
): Promise<ModelPreferences> {
  const response = await fetch("/api/account/model-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preferences),
  });
  return parseJson(response, parseModelPreferences);
}
