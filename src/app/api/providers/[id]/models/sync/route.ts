import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireParam } from "@/app/api/_lib/route-params";
import { syncProviderModelsSchema } from "@/lib/schemas/provider";
import { requireMember } from "@/server/auth/actor";
import { syncProviderModels } from "@/server/services/provider.service";

export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireMember(request.headers);
  const id = await requireParam(context, "id", "provider.notFound");
  const input = syncProviderModelsSchema.parse(await request.json());
  const result = await syncProviderModels(id, input, actor);
  return Response.json(result);
});
