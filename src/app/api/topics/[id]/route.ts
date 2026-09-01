import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { renameTopicSchema } from "@/lib/schemas/topic";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { deleteTopic, renameTopic } from "@/server/services/topic.service";

async function topicId(
  context: { params: Promise<Record<string, string>> } | undefined,
): Promise<string> {
  const id = (await context?.params)?.id;
  if (!id) {
    throw new AppError("NOT_FOUND", 404, "Topic not found");
  }
  return id;
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
