import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import {
  generationResponseSchema,
  generationsResponseSchema,
} from "@/lib/schemas/generation";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import {
  findGenerationByRequestId,
  listActiveGenerations,
  toGenerationSummary,
} from "@/server/services/generation.service";

/**
 * Generation discovery (chat task §6).
 *
 * `?active=true` — the account's still-running turns, used by the client to
 * find a response that outlived the page. `?requestId=…` — receipt lookup for
 * a request whose confirmation was lost. Both are owner-scoped by userId and
 * carry no message content.
 */
export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId");

  if (requestId !== null) {
    const row = await findGenerationByRequestId(requestId, actor);
    if (!row) {
      throw new AppError("NOT_FOUND", 404, "generation.notFound");
    }
    if (row.targetDeletedAt !== null) {
      throw new AppError("NOT_FOUND", 410, "generation.targetDeleted");
    }
    return Response.json(
      generationResponseSchema.parse({ generation: toGenerationSummary(row) }),
    );
  }

  if (url.searchParams.get("active") !== "true") {
    throw new AppError("VALIDATION_FAILED", 400, "validation.failed");
  }
  const rows = await listActiveGenerations(actor);
  return Response.json(
    generationsResponseSchema.parse({
      generations: rows.map(toGenerationSummary),
    }),
  );
});
