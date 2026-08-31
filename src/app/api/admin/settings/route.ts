import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { instanceSettingsSchema } from "@/lib/schemas/instance-settings";
import { requireAdmin } from "@/server/auth/actor";
import { updateInstanceSettings } from "@/server/services/instance-settings.service";

export const PATCH = withErrorHandling(async (request) => {
  const actor = await requireAdmin(request.headers);
  const input = instanceSettingsSchema.parse(await request.json());
  const settings = await updateInstanceSettings(input, actor);
  return Response.json(settings);
});
