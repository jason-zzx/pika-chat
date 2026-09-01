import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { createTopicSchema } from "@/lib/schemas/topic";
import { requireActor } from "@/server/auth/actor";
import { createTopic } from "@/server/services/topic.service";

export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = createTopicSchema.parse(await request.json());
  const topic = await createTopic(input, actor);
  return Response.json(topic, { status: 201 });
});
