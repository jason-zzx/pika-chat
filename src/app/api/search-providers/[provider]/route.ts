import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import {
  searchProviderSchema,
  upsertSearchProviderSchema,
} from "@/lib/schemas/search-provider";
import { requireActor } from "@/server/auth/actor";
import {
  deleteSearchProviderSetting,
  upsertSearchProviderSetting,
} from "@/server/services/search-provider.service";

type RouteContext = { params: Promise<Record<string, string>> } | undefined;

async function providerParam(context: RouteContext) {
  const raw = await requireParam(
    context,
    "provider",
    "searchProvider.notConfigured",
  );
  // An unknown provider name is a client input error, not a 404.
  return searchProviderSchema.parse(raw);
}

export const PUT = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const provider = await providerParam(context);
  const input = upsertSearchProviderSchema.parse(await request.json());
  const setting = await upsertSearchProviderSetting(provider, input, actor);
  return Response.json(setting);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const provider = await providerParam(context);
  await deleteSearchProviderSetting(provider, actor);
  return new Response(null, { status: 204 });
});
