import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { pairOrNull } from "@/lib/schemas/model-preferences";
import { compressTopicSchema } from "@/lib/schemas/topic";
import { requireModelForActor } from "@/server/ai/require-model";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { compressTopicHistory } from "@/server/services/compression.service";
import { resolveModelPreference } from "@/server/services/model-preferences.service";

/**
 * Manual history compression (PRD R2): folds the topic's current history
 * into its rolling summary. The summary model is the caller's `compression`
 * model preference when set, else the request body's pair (R6).
 */
export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "topic.notFound");
  const input = compressTopicSchema.parse(await request.json());

  const pair =
    (await resolveModelPreference(actor, "compression")) ?? pairOrNull(input);
  if (!pair) {
    throw new AppError("VALIDATION_FAILED", 400, "model.notAvailable");
  }

  // Same availability gate as the chat route: the summary model must be one
  // the caller may actually use.
  const { handle } = await requireModelForActor(pair, actor);

  const result = await compressTopicHistory({ topicId, handle }, actor);
  return Response.json({
    summaryUpToMessageId: result.summaryUpToMessageId,
    compressedCount: result.compressedCount,
  });
});
