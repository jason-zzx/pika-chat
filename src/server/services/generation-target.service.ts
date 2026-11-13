import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { AppError } from "@/server/errors";

import type { getDb } from "@/server/db/client";
import { chatGenerations, topics } from "@/server/db/schema";

/**
 * Target-deletion bookkeeping shared by the topic/assistant delete
 * transactions and the generation service (chat task §8).
 *
 * Kept in its own module — DB statements only — so the delete paths can mark
 * generations inside their own transaction without importing the generation
 * service (which imports the message service, which imports the topic
 * service: a cycle).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Tx | Db;

const ACTIVE_STATUSES = ["queued", "running", "stopping"] as const;

/**
 * Runs inside the caller's delete transaction, in the fixed parent→child order
 * (topic/assistant row lock already held by the caller):
 *
 * - every generation targeting these topics loses its content association
 *   (input, receipt hash, assistant message id) and is marked deleted, so a
 *   late finalize can recognize the deletion and drop its output instead of
 *   re-creating rows;
 * - turns that were still active become `stopped` here, which also releases
 *   the topic's partial unique slot before the row disappears.
 */
export async function markGenerationsForDeletedTopics(
  executor: Executor,
  topicIds: string[],
): Promise<void> {
  if (topicIds.length === 0) {
    return;
  }
  const now = new Date();
  // Stop the active turns FIRST: the clearing statement below also nulls
  // `topic_id` (the FK would do it on delete anyway), so a status update after
  // it would match nothing.
  await executor
    .update(chatGenerations)
    .set({ status: "stopped", finishedAt: now, errorMessage: null, updatedAt: now })
    .where(
      and(
        inArray(chatGenerations.topicId, topicIds),
        inArray(chatGenerations.status, [...ACTIVE_STATUSES]),
      ),
    );
  await executor
    .update(chatGenerations)
    .set({
      targetDeletedAt: now,
      updatedAt: now,
      input: null,
      requestHash: null,
      assistantMessageId: null,
      topicId: null,
    })
    .where(inArray(chatGenerations.topicId, topicIds));
}

/** Lock child topics before their tasks, matching finalize's topic → task order. */
export async function topicIdsForAssistant(
  tx: Executor,
  assistantId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.assistantId, assistantId))
    .orderBy(asc(topics.id))
    .for("update");
  return rows.map((row) => row.id);
}

/**
 * Context mutations (delete/select version, manual compression) are refused
 * while the topic has an active turn (chat task §8): the running answer was
 * generated from a specific version selection, so changing the selection or
 * the summary underneath it would make history and the reply disagree. The
 * check runs in the caller's transaction, taking the topic row lock first
 * (parent → child), the same order admission uses.
 */
export async function lockTopicAndAssertIdle(
  tx: Executor,
  topicId: string,
  options: {
    /**
     * Auto-compression runs INSIDE its own turn: the turn's active generation
     * row is the caller, not a competing writer, so it must not make the
     * compaction refuse itself (chat task §7).
     */
    exceptGenerationId?: string;
  } = {},
): Promise<void> {
  const locked = await tx
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.id, topicId))
    .for("update");
  if (locked.length === 0) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  const active = await tx
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
    .limit(1);
  if (active.length > 0) {
    throw new AppError("CONFLICT", 409, "generation.topicBusy");
  }
}
