import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { reorderSearchProvidersSchema } from "@/lib/schemas/search-provider";
import { requireActor } from "@/server/auth/actor";
import { reorderSearchProviders } from "@/server/services/search-provider.service";

export const PATCH = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = reorderSearchProvidersSchema.parse(await request.json());
  const providers = await reorderSearchProviders(input, actor);
  return Response.json({ providers });
});
