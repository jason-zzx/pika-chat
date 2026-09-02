import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { stopChatRequestSchema } from "@/lib/schemas/chat";
import { abortStream } from "@/server/ai/stream-registry";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = stopChatRequestSchema.parse(await request.json());
  const aborted = abortStream(input.streamId, actor.userId);
  if (!aborted) {
    throw new AppError("NOT_FOUND", 404, "Stream not found");
  }
  return new Response(null, { status: 204 });
});
