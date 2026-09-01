import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { updateProviderConfigSchema } from "@/lib/schemas/provider";
import { AppError } from "@/server/errors";
import { requireActor } from "@/server/auth/actor";
import {
  deleteProviderConfig,
  updateProviderConfig,
} from "@/server/services/provider.service";

async function providerId(
  context: { params: Promise<Record<string, string>> } | undefined,
): Promise<string> {
  const id = (await context?.params)?.id;
  if (!id) {
    throw new AppError("NOT_FOUND", 404, "Provider not found");
  }
  return id;
}

export const PATCH = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const input = updateProviderConfigSchema.parse(await request.json());
  const config = await updateProviderConfig(
    await providerId(context),
    input,
    actor,
  );
  return Response.json(config);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  await deleteProviderConfig(await providerId(context), actor);
  return new Response(null, { status: 204 });
});
