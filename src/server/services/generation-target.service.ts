import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";

import type { DbExecutor } from "@/server/db/client";
import { chatGenerations, topics } from "@/server/db/schema";
import { AppError } from "@/server/errors";

/**
 * Target-deletion bookkeeping shared by the topic/assistant delete
 * transactions and the generation service (chat task §8).
 *
 * Kept in its own module — DB statements only — so the delete paths can mark
 * generations inside their own transaction without importing the generation
 * service (which imports the message service, which imports the topic
 * service: a cycle).
 */

const ACTIVE_STATUSES = ["queued", "running", "stopping"] as const;

/**
 * Runs inside the caller's synchronous immediate transaction:
 *
 * - every generation targeting these topics loses its content association
 *   (input, receipt hash, assistant message id) and is marked deleted, so a
 *   late finalize can recognize the deletion and drop its output instead of
 *   re-creating rows;
 * - turns that were still active become `stopped` here, which also releases
 *   the topic's partial unique slot before the row disappears.
 */
export function markGenerationsForDeletedTopics(
  executor: DbExecutor,
  topicIds: string[],
): void {
  if (topicIds.length === 0) {
    return;
  }
  const now = new Date();
  // Stop the active turns FIRST: the clearing statement below also nulls
  // `topic_id` (the FK would do it on delete anyway), so a status update after
  // it would match nothing.
  executor
    .update(chatGenerations)
    .set({ status: "stopped", finishedAt: now, errorMessage: null, updatedAt: now })
    .where(
      and(
        inArray(chatGenerations.topicId, topicIds),
        inArray(chatGenerations.status, [...ACTIVE_STATUSES]),
      ),
    )
    .run();
  executor
    .update(chatGenerations)
    .set({
      targetDeletedAt: now,
      updatedAt: now,
      input: null,
      requestHash: null,
      assistantMessageId: null,
      topicId: null,
    })
    .where(inArray(chatGenerations.topicId, topicIds))
    .run();
}

export function topicIdsForAssistant(
  tx: DbExecutor,
  assistantId: string,
): string[] {
  const rows = tx
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.assistantId, assistantId))
    .orderBy(asc(topics.id))
    .all();
  return rows.map((row) => row.id);
}

/**
 * Context mutations (delete/select version, manual compression) are refused
 * while the topic has an active turn (chat task §8): the running answer was
 * generated from a specific version selection, so changing the selection or
 * the summary underneath it would make history and the reply disagree. Runs
 * inside the caller's synchronous immediate transaction.
 */
export function lockTopicAndAssertIdle(
  tx: DbExecutor,
  topicId: string,
  options: {
    /**
     * Auto-compression runs INSIDE its own turn: the turn's active generation
     * row is the caller, not a competing writer, so it must not make the
     * compaction refuse itself (chat task §7).
     */
    exceptGenerationId?: string;
  } = {},
): void {
  const locked = tx
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.id, topicId))
    .get();
  if (!locked) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  const active = tx
    .select({ id: chatGenerations.id })
    .from(chatGenerations)
    .where(
      and(
        eq(chatGenerations.topicId, topicId),
        inArray(chatGenerations.status, [...ACTIVE_STATUSES]),
        options.exceptGenerationId === undefined
          ? undefined
          : ne(chatGenerations.id, options.exceptGenerationId),
      ),
    )
    .limit(1)
    .get();
  if (active) {
    throw new AppError("CONFLICT", 409, "generation.topicBusy");
  }
}
