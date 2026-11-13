import { respondWithGeneration } from "@/app/api/chat/_lib/generation-response";
import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireActor } from "@/server/auth/actor";

/**
 * Reconnects to an existing generation (chat task §6).
 *
 * Live: the response starts with the current answer state and continues with
 * the live increments — the client's SDK replaces its own partial in place by
 * message id (`resumeStreamIsReplay`). Finished: 204 with no body, and the
 * client refreshes history (the replay path belongs to the duplicate POST, not
 * to resume — otherwise a resumed view would receive the answer twice).
 * Deleted target: 410. Every request authorizes against the account: a task
 * belongs to a user, not to a browser session.
 */
export const GET = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const id = await requireParam(context, "id", "generation.notFound");
  return respondWithGeneration({
    generationId: id,
    actor,
    mode: "resume",
  });
});
