import { createUIMessageStreamResponse } from "ai";

import { isActiveGenerationStatus } from "@/lib/schemas/generation";
import {
  ensureGenerationRunning,
  finishedGenerationChunks,
  subscribeToGeneration,
} from "@/server/ai/generation-runner";
import type { ChatChunk } from "@/server/ai/generation-stream";
import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  findGenerationForActor,
  type GenerationRow,
} from "@/server/services/generation.service";
import { loadMessagesByIds } from "@/server/services/message.service";

/**
 * How a caller answers.
 *
 * - `follow` — the POST that admitted (or replayed) the request. A duplicate
 *   POST whose confirmation was lost replays the persisted answer once, so the
 *   client can recover it without a second model call.
 * - `resume` — the reconnect GET (`/generations/[id]/stream`). A finished turn
 *   answers 204 with no body: the client refreshes history instead, so the
 *   resume path never re-injects an already seeded answer (chat task §6).
 */
export type GenerationResponseMode = "follow" | "resume";

/**
 * The one HTTP shape every accepted generation answers with (chat task §6):
 * a 200 UI-message SSE that subscribes to the executor — never the producer.
 *
 * - active: attach as a subscriber; the stream starts with the current answer
 *   state (so a reconnecting client resumes mid-answer) and continues live;
 * - terminal + `follow`: replay the persisted answer once;
 * - terminal + `resume`: 204, no body;
 * - deleted target: 410, and the client stops trying.
 *
 * Every caller authorizes on connect; once opened, the subscription remains
 * active until the turn ends, the target is deleted, or the client disconnects.
 */
export async function respondWithGeneration(input: {
  generationId: string;
  actor: Actor;
  mode: GenerationResponseMode;
  /** Extra response headers (the regenerate route exposes its legacy id). */
  headers?: Record<string, string>;
}): Promise<Response> {
  const row = await findGenerationForActor(input.generationId, input.actor);
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "generation.notFound");
  }
  if (row.targetDeletedAt !== null) {
    throw new AppError("NOT_FOUND", 410, "generation.targetDeleted");
  }
  const headers: Record<string, string> = {
    ...input.headers,
    "x-pika-generation-id": row.id,
  };

  if (isActiveGenerationStatus(row.status)) {
    const live = await ensureGenerationRunning(row.id);
    if (!live) {
      // No producer took it: the process is shutting down, or another writer
      // closed the task between the read and the claim. Re-read once and either
      // answer from the settled state or tell the client to come back — never
      // replay a still-active task with no content behind it.
      const settled = await findGenerationForActor(row.id, input.actor);
      if (!settled) {
        throw new AppError("NOT_FOUND", 404, "generation.notFound");
      }
      if (!isActiveGenerationStatus(settled.status)) {
        return settledResponse(settled, input, headers);
      }
      throw new AppError("INTERNAL", 503, "generation.notRunning");
    }
    return sse(subscribeToGeneration(live), headers);
  }

  return settledResponse(row, input, headers);
}

/** A turn that is no longer active: replay (POST) or 204 (resume). */
function settledResponse(
  row: GenerationRow,
  input: { mode: GenerationResponseMode; actor: Actor },
  headers: Record<string, string>,
): Response | Promise<Response> {
  if (input.mode === "resume") {
    // The persisted answer is history's job: the client refetches and seeds
    // the canonical view. Replaying it here would race that seed.
    logger.info(
      { generationId: row.id, status: row.status },
      "generation resume answered 204 (already settled)",
    );
    return new Response(null, { status: 204, headers });
  }
  return replayTerminal(row, input.actor, headers);
}

async function replayTerminal(
  row: GenerationRow,
  actor: Actor,
  headers: Record<string, string>,
): Promise<Response> {
  const message =
    row.topicId !== null && row.assistantMessageId !== null
      ? ((
          await loadMessagesByIds(
            { topicId: row.topicId, ids: [row.assistantMessageId] },
            actor,
          )
        )[0] ?? null)
      : null;
  logger.info(
    { generationId: row.id, status: row.status, hasMessage: message !== null },
    "generation replayed from persisted state",
  );
  return sse(chunksToStream(finishedGenerationChunks(row, message)), headers);
}

function chunksToStream(chunks: ChatChunk[]): ReadableStream<ChatChunk> {
  return new ReadableStream<ChatChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

/** SSE framing for UI-message chunks (same protocol the send route always used). */
export function sse(
  stream: ReadableStream<ChatChunk>,
  headers: Record<string, string> = {},
): Response {
  return createUIMessageStreamResponse({
    stream: stream as unknown as ReadableStream<never>,
    headers,
  });
}
