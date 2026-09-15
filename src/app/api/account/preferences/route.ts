import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { themePreferencesRequestSchema } from "@/lib/schemas/theme-preferences";
import { requireActor } from "@/server/auth/actor";
import { updateUserThemePreference } from "@/server/services/user-preferences.service";

export const PATCH = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = themePreferencesRequestSchema.parse(await request.json());
  const preference = await updateUserThemePreference(actor.userId, input);
  return Response.json({
    themeMode: preference.mode,
    themePreset: preference.preset,
  });
});
