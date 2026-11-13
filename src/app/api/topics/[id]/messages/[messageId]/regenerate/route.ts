import { getLocale, getTranslations } from "next-intl/server";

import { respondWithGeneration } from "@/app/api/chat/_lib/generation-response";
import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { regenerateMessageRequestSchema } from "@/lib/schemas/chat";
import {
  prepareRegenerateTurn,
  regenerateRequestHash,
} from "@/server/ai/generation-turn";
import { requireActor } from "@/server/auth/actor";
import { logger } from "@/server/logger";
import { admitTurn } from "@/server/services/generation.service";

/**
 * Streams a new version for the answer at `messageId` (or the answer that
 * follows an edited user message).
 *
 * Same admission/executor split as `/api/chat` (chat task §6): the response is
 * a subscriber, the generation outlives it. The response keeps its legacy
 * `x-pika-stream-id` header — it now carries the durable generation id, which
 * is what `/api/chat/stop` accepts — and, as before, adds no `data-topic`.
 */
export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const tChat = await getTranslations("Chat");
  const locale = await getLocale();
  const topicId = await requireParam(context, "id", "topic.notFound");
  const messageId = await requireParam(
    context,
    "messageId",
    "message.notFound",
  );
  const input = regenerateMessageRequestSchema.parse(await request.json());

  // Receipt lookup runs before preparation (chat task §4): a retry of an
  // accepted edit/regenerate must find its task even when the model or the
  // edited message would no longer validate.
  const requestHash = regenerateRequestHash({ topicId, messageId, request: input });

  const { generation, duplicate } = await admitTurn(
    { requestId: input.requestId, requestHash },
    () =>
      prepareRegenerateTurn(
        {
          topicId,
          messageId,
          request: input,
          defaultTopicTitle: tChat("newTopic"),
          actorRole: actor.role,
          locale,
        },
        actor,
      ),
    actor,
  );

  logger.info(
    {
      userId: actor.userId,
      generationId: generation.id,
      topicId,
      messageId,
      kind: generation.kind,
      duplicate,
    },
    "chat regeneration accepted",
  );

  return respondWithGeneration({
    generationId: generation.id,
    actor,
    mode: "follow",
    headers: { "x-pika-stream-id": generation.id },
  });
});
