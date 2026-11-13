import { getLocale, getTranslations } from "next-intl/server";

import { respondWithGeneration } from "@/app/api/chat/_lib/generation-response";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { chatRequestSchema } from "@/lib/schemas/chat";
import { prepareSendTurn, sendRequestHash } from "@/server/ai/generation-turn";
import { requireActor } from "@/server/auth/actor";
import { logger } from "@/server/logger";
import { admitTurn } from "@/server/services/generation.service";

/**
 * Sends a message and streams the answer.
 *
 * The request is admitted — validated, persisted, queued — and this response
 * is only a subscriber to the executor that runs the turn (chat task §4/§6).
 * A browser disconnect therefore ends the subscription, not the generation; a
 * retry with the same `requestId` finds the same task instead of calling the
 * model again. The response stays a 200 UI-message SSE with `data-topic`, so
 * existing clients keep working unchanged.
 */
export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  // Transport-boundary copy: the new-topic sentinel is stored data, and the
  // locale is captured here because the turn runs without a request scope.
  const tChat = await getTranslations("Chat");
  const locale = await getLocale();
  const input = chatRequestSchema.parse(await request.json());

  // The digest is computed from the raw request so the receipt lookup can run
  // BEFORE preparation: a retry of an accepted request must find its task even
  // if the model was disabled or an attachment has since become unavailable.
  const requestHash = sendRequestHash(input);

  const { generation, duplicate } = await admitTurn(
    { requestId: input.requestId, requestHash },
    () =>
      prepareSendTurn(
        {
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
      topicId: generation.topicId,
      duplicate,
    },
    "chat generation accepted",
  );

  return respondWithGeneration({
    generationId: generation.id,
    actor,
    mode: "follow",
  });
});
