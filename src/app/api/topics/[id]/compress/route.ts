import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { compressTopicSchema } from "@/lib/schemas/topic";
import { requireModelForActor } from "@/server/ai/require-model";
import { requireActor } from "@/server/auth/actor";
import { compressTopicHistory } from "@/server/services/compression.service";

/**
 * Manual history compression (PRD R2): folds the topic's current history
 * into its rolling summary using the session's own model (R6 — zero config).
 */
export const POST = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const topicId = await requireParam(context, "id", "topic.notFound");
  const input = compressTopicSchema.parse(await request.json());

  // Same availability gate as the chat route: the summary model must be one
  // the caller may actually use.
  const { handle } = await requireModelForActor(
    {
      providerConfigId: input.providerConfigId,
      modelId: input.modelId,
    },
    actor,
  );

  const result = await compressTopicHistory({ topicId, handle }, actor);
  return Response.json({
    summaryUpToMessageId: result.summaryUpToMessageId,
    compressedCount: result.compressedCount,
  });
});
