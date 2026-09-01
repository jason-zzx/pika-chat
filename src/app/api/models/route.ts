import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import { requireActor } from "@/server/auth/actor";

export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const models = await resolveAvailableModels(actor);
  return Response.json(models);
});
