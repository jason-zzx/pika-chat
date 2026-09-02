import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireActor } from "@/server/auth/actor";
import { listTopicMessages } from "@/server/services/message.service";

export const GET = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "Topic not found");
  const messages = await listTopicMessages({ topicId }, actor);
  return Response.json({ messages });
});
