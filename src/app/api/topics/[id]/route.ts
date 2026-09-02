import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { renameTopicSchema } from "@/lib/schemas/topic";
import { requireActor } from "@/server/auth/actor";
import { deleteTopic, renameTopic } from "@/server/services/topic.service";

function topicId(context: Parameters<typeof requireParam>[0]): Promise<string> {
  return requireParam(context, "id", "Topic not found");
}

export const PATCH = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const input = renameTopicSchema.parse(await request.json());
  const topic = await renameTopic(await topicId(context), input, actor);
  return Response.json(topic);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  await deleteTopic(await topicId(context), actor);
  return new Response(null, { status: 204 });
});
