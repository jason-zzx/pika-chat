import { parseEmpty } from "@/lib/api/parse";
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
