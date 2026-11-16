import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { generateTopicTitleSchema } from "@/lib/schemas/topic";
import { waitForPostTurnTasks } from "@/server/ai/generation-runner";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import {
  findTopicDetailForActor,
  findTopicForActor,
} from "@/server/services/topic.service";
import { titleTopicFromFirstMessage } from "@/server/services/title.service";

/**
 * Waits for the topic's server-side title task, then returns the topic: the
 * title runs beside the answer and no stream carries it, so the client asks
 * here instead of guessing when to refetch.
 */
export const GET = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "topic.notFound");
  // Ownership first: waiting on someone else's topic would leak, by timing,
  // whether it is being named.
  if (!(await findTopicForActor(topicId, actor))) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  await waitForPostTurnTasks(topicId);
  const topic = await findTopicDetailForActor(topicId, actor);
  if (!topic) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  return Response.json(topic);
});

export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "topic.notFound");
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
