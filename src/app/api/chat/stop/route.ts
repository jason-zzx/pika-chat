import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { stopChatRequestSchema } from "@/lib/schemas/chat";
import { stopGenerationById } from "@/server/ai/generation-runner";
import { requireActor } from "@/server/auth/actor";

/**
 * Stops a generation.
 *
 * The body keeps its `{ streamId }` shape, but the value is now the durable
 * generation id the send/regenerate responses hand out (and that `data-topic`
 * carries), not an ephemeral in-memory stream handle. Stopping is idempotent:
 * stopping a turn that already ended is a no-op success, so a double tap or a
 * late stop from a stale tab cannot fail the UI.
 */
export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = stopChatRequestSchema.parse(await request.json());
  await stopGenerationById(input.streamId, actor);
  return new Response(null, { status: 204 });
});
