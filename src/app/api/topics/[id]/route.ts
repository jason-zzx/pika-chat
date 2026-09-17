import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { renameTopicSchema } from "@/lib/schemas/topic";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import {
  deleteTopic,
  findTopicDetailForActor,
  renameTopic,
} from "@/server/services/topic.service";

function topicId(context: Parameters<typeof requireParam>[0]): Promise<string> {
  return requireParam(context, "id", "topic.notFound");
}

export const GET = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topic = await findTopicDetailForActor(await topicId(context), actor);
  if (!topic) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  return Response.json(topic);
});

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
