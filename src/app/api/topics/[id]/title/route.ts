import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { generateTopicTitleSchema } from "@/lib/schemas/topic";
import { requireActor } from "@/server/auth/actor";
import { titleTopicFromFirstMessage } from "@/server/services/title.service";

export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "Topic not found");
  const input = generateTopicTitleSchema.parse(await request.json());
  const topic = await titleTopicFromFirstMessage(
    {
      topicId,
      providerConfigId: input.providerConfigId,
      modelId: input.modelId,
    },
    actor,
  );
  return Response.json(topic);
});
