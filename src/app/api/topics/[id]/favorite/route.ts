import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { setTopicFavoriteSchema } from "@/lib/schemas/topic";
import { requireActor } from "@/server/auth/actor";
import { setTopicFavorite } from "@/server/services/topic.service";

export const PATCH = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "topic.notFound");
  const input = setTopicFavoriteSchema.parse(await request.json());
  const topic = await setTopicFavorite(topicId, input, actor);
  return Response.json(topic);
});
