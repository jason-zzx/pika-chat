import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { modelPreferencesSchema } from "@/lib/schemas/model-preferences";
import { requireActor } from "@/server/auth/actor";
import {
  getModelPreferences,
  updateModelPreferences,
} from "@/server/services/model-preferences.service";

export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const preferences = await getModelPreferences(actor.userId);
  return Response.json(preferences);
});

export const PATCH = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = modelPreferencesSchema.parse(await request.json());
  const preferences = await updateModelPreferences(input, actor);
  return Response.json(preferences);
});
