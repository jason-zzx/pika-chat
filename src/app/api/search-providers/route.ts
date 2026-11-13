import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireMember } from "@/server/auth/actor";
import { listSearchProviderSettings } from "@/server/services/search-provider.service";

export const GET = withErrorHandling(async (request) => {
  const actor = await requireMember(request.headers);
  const providers = await listSearchProviderSettings(actor);
  return Response.json({ providers });
});
