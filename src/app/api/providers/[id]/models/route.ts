import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { addProviderModelSchema } from "@/lib/schemas/provider";
import { AppError } from "@/server/errors";
import { requireActor } from "@/server/auth/actor";
import {
  addProviderModel,
  removeProviderModel,
} from "@/server/services/provider.service";

export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const id = (await context?.params)?.id;
  if (!id) {
    throw new AppError("NOT_FOUND", 404, "Provider not found");
  }
  const input = addProviderModelSchema.parse(await request.json());
  const model = await addProviderModel(id, input, actor);
  return Response.json(model, { status: 201 });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const id = (await context?.params)?.id;
  const modelId = new URL(request.url).searchParams.get("modelId");
  if (!id || !modelId) {
    throw new AppError("NOT_FOUND", 404, "Model not found");
  }
  await removeProviderModel(id, modelId, actor);
  return new Response(null, { status: 204 });
});
