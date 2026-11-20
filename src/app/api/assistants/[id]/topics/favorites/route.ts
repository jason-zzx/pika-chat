import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireActor } from "@/server/auth/actor";
import { listFavoriteTopics } from "@/server/services/topic.service";

export const GET = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const assistantId = await requireParam(context, "id", "assistant.notFound");
  return Response.json({
    topics: await listFavoriteTopics(assistantId, actor),
  });
});
