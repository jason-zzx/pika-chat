import { parseJson } from "@/lib/api/parse";
import {
  generationResponseSchema,
  generationsResponseSchema,
  type GenerationResponse,
  type GenerationsResponse,
} from "@/lib/schemas/generation";

/**
 * Client side of server-managed generations (chat task §6).
 *
 * Deliberately tiny: these endpoints only answer "which turn of mine is still
 * running?" and "what is the task id for this request?". Message content comes
 * from the SSE stream (live) or history (finished), never from here — there is
 * no full-text task detail endpoint.
 */

/**
 * Query keys are scoped by account: the QueryClient (and the chat pool) live
 * for the whole document, and a document that outlives an account change must
 * never read the previous account's active turns or receipt lookups from
 * cache. `null` (anonymous/tests) gets its own namespace rather than sharing
 * the signed-in one.
 */
export const generationKeys = {
  all: (userId: string | null) =>
    ["generations", userId ?? "anonymous"] as const,
  active: (userId: string | null) =>
    [...generationKeys.all(userId), "active"] as const,
  request: (userId: string | null, requestId: string) =>
    [...generationKeys.all(userId), "request", requestId] as const,
};

export async function listActiveGenerations(): Promise<GenerationsResponse> {
  const response = await fetch("/api/chat/generations?active=true");
  return parseJson(response, (data) => generationsResponseSchema.parse(data));
}

export async function findGenerationByRequest(
  requestId: string,
): Promise<GenerationResponse> {
  const response = await fetch(
    `/api/chat/generations?requestId=${encodeURIComponent(requestId)}`,
  );
  return parseJson(response, (data) => generationResponseSchema.parse(data));
}

/** URL the SDK reconnects to for one generation. */
export function generationStreamUrl(generationId: string): string {
  return `/api/chat/generations/${encodeURIComponent(generationId)}/stream`;
}
