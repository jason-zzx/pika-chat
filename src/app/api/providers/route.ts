import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { createProviderConfigSchema } from "@/lib/schemas/provider";
import { requireActor } from "@/server/auth/actor";
import {
  createProviderConfig,
  listProviderConfigs,
} from "@/server/services/provider.service";

export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const configs = await listProviderConfigs(actor);
  return Response.json(configs);
});

export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = createProviderConfigSchema.parse(await request.json());
  const config = await createProviderConfig(input, actor);
  return Response.json(config, { status: 201 });
});
