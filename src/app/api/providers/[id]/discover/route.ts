import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { AppError } from "@/server/errors";
import { requireActor } from "@/server/auth/actor";
import { discoverProviderModels } from "@/server/services/provider.service";

export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const id = (await context?.params)?.id;
  if (!id) {
    throw new AppError("NOT_FOUND", 404, "provider.notFound");
  }
  const modelIds = await discoverProviderModels(id, actor);
  return Response.json({ modelIds });
});
