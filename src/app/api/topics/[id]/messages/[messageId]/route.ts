import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireActor } from "@/server/auth/actor";
import { deleteMessage } from "@/server/services/message.service";

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "topic.notFound");
  const messageId = await requireParam(context, "messageId", "message.notFound");
  await deleteMessage({ topicId, messageId }, actor);
  return new Response(null, { status: 204 });
});
