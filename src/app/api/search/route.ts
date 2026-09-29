import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { SEARCH_QUERY_MAX_LENGTH } from "@/lib/schemas/search";
import { requireActor } from "@/server/auth/actor";
import { searchForActor } from "@/server/services/search.service";

export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const raw = new URL(request.url).searchParams.get("q") ?? "";
  // Overlong queries are truncated, not rejected; an empty query is a valid
  // "nothing to search" and returns empty groups rather than a 400.
  const query = raw.trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  if (query.length === 0) {
    return Response.json({ topics: [], messages: [] });
  }
  return Response.json(await searchForActor(actor, query));
});
