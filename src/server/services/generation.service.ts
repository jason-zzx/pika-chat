import "server-only";

import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import type { ActorRole } from "@/lib/auth-hierarchy";
import type { ErrorsTranslator } from "@/lib/api/error-contract";
import { newId, newTopicId } from "@/lib/id";
import { errorsTranslatorFor } from "@/i18n/server-translator";
import type { ImageGenerationParams } from "@/lib/schemas/chat";
import {
  ACTIVE_GENERATION_STATUSES,
  isActiveGenerationStatus,
  type GenerationKind,
  type GenerationStatus,
  type GenerationSummary,
} from "@/lib/schemas/generation";
import type { Actor } from "@/server/auth/actor";
import { getDb, type DbTransaction } from "@/server/db/client";
import {
  chatGenerations,
  chatMessages,
  topics,
  users,
  type ChatGenerationInput,
} from "@/server/db/schema";
import { consumeGuestModelTurnQuota } from "@/server/services/demo-usage.service";
import { insertWithShortId } from "@/server/db/short-id-insert";
import { isUniqueViolation } from "@/server/db/unique-violation";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  insertAssistantRow,
  insertUserMessageRow,
  insertUserMessageVersionRow,
  writeAssistantTurnRow,
  type AssistantTurnWrite,
} from "@/server/services/message.service";

/**
 * Server-managed generation lifecycle (chat task R1–R6).
 *
 * This module owns every durable transition of a `chat_generations` row plus
 * the admission transaction that creates it. Execution itself lives in
 * `src/server/ai/generation-runner.ts`; the two meet only through these
 * functions so the "claim at most once" rule has exactly one implementation.
 */

export type GenerationRow = typeof chatGenerations.$inferSelect;

/**
 * Everything admission needs, already validated by `prepareTurn` (no writes,
 * no transaction): model availability, attachment routability, image params,
 * the frozen history ids and the canonical user message to persist.
 */
export type PreparedTurn = {
  kind: GenerationKind;
  assistantId: string;
  /** Existing topic, or null when the send creates one. */
  topicId: string | null;
  providerConfigId: string;
  modelId: string;
  reasoningEffort?: string;
  searchMode?: ChatGenerationInput["searchMode"];
  image?: ImageGenerationParams;
  timeZone?: string;
  /** Selected-version history the model sees (placeholder excluded). */
  historyMessageIds: string[];
  /** Canonical user/edit message to persist at admission. */
  userMessage?: {
    message: { id: string; role: "user"; parts: { type: string }[] };
    /** Existing user group the edit becomes a new version of. */
    versionOfGroupId?: string;
  };
  /** Regenerate: the message the client clicked. */
  targetMessageId?: string;
  /** Assistant row placement (regenerate joins the answer group). */
  assistantGroupId?: string;
  assistantGroupCreatedAt?: Date;
  /** Default title for a topic created by this send (request locale). */
  defaultTopicTitle: string;
  /** Whether the turn may generate a title (topic still sentinel-titled). */
  titleCandidate: boolean;
  /** Actor role captured at admission so the background turn resolves the
   * same model set without a request-scoped session. */
  actorRole: ActorRole;
  /** True when admitted by an anonymous demo guest. */
  actorIsGuest?: boolean;
  /** Digest of the canonical request, used to tell a retry from a collision. */
  requestHash: string;
  /** Request locale, captured so the background turn can localize errors. */
  locale?: string;
  /**
   * Assistant system prompt frozen at preparation. Stored with the task so the
   * executor never re-reads mutable configuration that may have changed
   * between preparation and execution.
   */
  systemPrompt?: string | null;
  /**
   * Compression state the turn was planned against: the summary text plus the
   * boundary the preparation already clipped the history with. Admission
   * rejects the turn when the durable boundary moved in between, and the
   * executor starts from this snapshot instead of the current row.
   */
  summary?: {
    text: string;
    boundaryMessageId: string | null;
    boundaryGroupId: string | null;
  } | null;
};

/**
 * Clock used for the G2 window checks. The database is the single authority:
 * container/host clock drift must not extend or shorten a request key window,
 * so callers default to `databaseNow()` and tests may inject one.
 */
export type Clock = () => Promise<Date>;

export async function databaseNow(): Promise<Date> {
  const rows = await getDb().execute<{ now: Date | string }>(
    sql`select now() as now`,
  );
  const value = rows[0]?.now;
  // postgres-js hands back the raw column value (a Date when the type parser
  // is registered, otherwise the text form); accept both.
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    throw new AppError("INTERNAL", 500, "generic");
  }
  return date;
}

export type AdmittedGeneration = {
  generation: GenerationRow;
  /** True when an existing receipt was returned instead of a new task. */
  duplicate: boolean;
};

/** 24h key window: a client may retry a request id this old, no older. */
export const REQUEST_KEY_TTL_MS = 24 * 60 * 60 * 1000;
/** Tolerance for a client clock that runs slightly ahead of the server. */
export const REQUEST_KEY_FUTURE_MS = 5 * 60 * 1000;

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Embedded creation time of a UUIDv7 request id (the first 48 bits of the
 * UUID are the millisecond timestamp). Returns null for anything else — the
 * G2 receipt rules are stated in terms of "the id's own time".
 */
export function requestKeyTime(requestId: string): number | null {
  if (!UUID_V7.test(requestId)) {
    return null;
  }
  return Number.parseInt(requestId.replaceAll("-", "").slice(0, 12), 16);
}

export function toGenerationSummary(row: GenerationRow): GenerationSummary {
  return {
    id: row.id,
    topicId: row.topicId,
    assistantId: row.input?.assistantId ?? null,
    assistantMessageId: row.assistantMessageId,
    kind: row.kind,
    status: row.status,
    targetDeleted: row.targetDeletedAt !== null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

// --- Reads -----------------------------------------------------------------

export async function findGenerationForActor(
  id: string,
  actor: Actor,
): Promise<GenerationRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chatGenerations)
    .where(and(eq(chatGenerations.id, id), eq(chatGenerations.userId, actor.userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findGenerationByRequestId(
  requestId: string,
  actor: Actor,
): Promise<GenerationRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chatGenerations)
    .where(
      and(
        eq(chatGenerations.userId, actor.userId),
        eq(chatGenerations.requestId, requestId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Lightweight discovery payload: active tasks of the account, nothing else. */
export async function listActiveGenerations(
  actor: Actor,
): Promise<GenerationRow[]> {
  const db = getDb();
  return db
    .select()
    .from(chatGenerations)
    .where(
      and(
        eq(chatGenerations.userId, actor.userId),
        inArray(chatGenerations.status, [...ACTIVE_GENERATION_STATUSES]),
      ),
    )
    .orderBy(desc(chatGenerations.createdAt));
}

/** Rows an executor must consider at boot / maintenance. */
export async function listQueuedGenerationIds(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: chatGenerations.id })
    .from(chatGenerations)
    .where(eq(chatGenerations.status, "queued"))
    .orderBy(asc(chatGenerations.createdAt));
  return rows.map((row) => row.id);
}

// --- Admission -------------------------------------------------------------

/**
 * Applies the G2 key-window rules to a client request id and returns the
 * receipt expiry to persist. Throws before anything is written, so an expired
 * or clock-skewed key can never reach model/attachment validation.
 *
 * "The id's own time" is the UUIDv7 timestamp, and the comparison is made
 * against the DATABASE clock (chat task §4): the browser and the app process
 * are both allowed to drift.
 */
export async function resolveRequestKey(
  requestId: string,
  clock: Clock,
): Promise<Date> {
  const keyTime = requestKeyTime(requestId);
  if (keyTime === null) {
    throw new AppError("VALIDATION_FAILED", 400, "generation.invalidRequestId");
  }
  const now = await clock();
  const age = now.getTime() - keyTime;
  if (age > REQUEST_KEY_TTL_MS) {
    throw new AppError("VALIDATION_FAILED", 400, "generation.requestExpired", {
      serverTime: now.toISOString(),
    });
  }
  if (age < -REQUEST_KEY_FUTURE_MS) {
    throw new AppError("VALIDATION_FAILED", 400, "generation.requestClockAhead", {
      serverTime: now.toISOString(),
    });
  }
  return new Date(keyTime + REQUEST_KEY_TTL_MS);
}

/**
 * Looks an existing receipt up and applies the duplicate rules.
 *
 * A receipt is found regardless of its age: an active turn that has run for
 * longer than the key window still belongs to the client that lost its
 * response, and a retry must never start a second model call. Returns null
 * when the account has no receipt for this id.
 */
export async function findReceipt(
  requestId: string,
  requestHash: string,
  actor: Actor,
): Promise<GenerationRow | null> {
  const existing = await findGenerationByRequestId(requestId, actor);
  if (!existing) {
    return null;
  }
  assertReceiptMatches(existing, requestHash);
  return existing;
}

/** Shared duplicate rules for an existing receipt (chat task §4). */
function assertReceiptMatches(row: GenerationRow, requestHash: string): void {
  if (row.targetDeletedAt !== null) {
    throw new AppError("NOT_FOUND", 410, "generation.targetDeleted");
  }
  if (row.requestHash !== requestHash) {
    throw new AppError("CONFLICT", 409, "generation.requestConflict");
  }
}

/**
 * Request-entry sequence shared by both POST routes (chat task §4 steps 2–4):
 *
 * 1. find an existing receipt for the same request id and payload — this runs
 *    BEFORE `prepare`, because a retry of an accepted request must find its
 *    task even when the model was disabled or an attachment/target has since
 *    become unavailable;
 * 2. validate the key window for a NEW key (again before `prepare`), so an
 *    expired id is refused without touching model/attachment validation;
 * 3. only then validate + admit, inside `acceptTurn`.
 *
 * `prepare` must therefore be free of writes and side effects, and is the
 * authorization boundary that establishes ownership of `assistantId` / `topicId`.
 */
export async function admitTurn(
  input: { requestId?: string; requestHash: string },
  prepare: () => Promise<PreparedTurn>,
  actor: Actor,
  options: { clock?: Clock } = {},
): Promise<AdmittedGeneration> {
  const clock = options.clock ?? databaseNow;
  let requestExpiresAt: Date | null = null;
  if (input.requestId) {
    const existing = await findReceipt(input.requestId, input.requestHash, actor);
    if (existing) {
      return { generation: existing, duplicate: true };
    }
    requestExpiresAt = await resolveRequestKey(input.requestId, clock);
  }
  const prepared = await prepare();
  return acceptTurn(prepared, actor, {
    requestId: input.requestId,
    requestExpiresAt,
  });
}

/**
 * Admits one turn: topic-scoped mutex and the single transaction that writes
 * the user message, the assistant placeholder and the queued task (chat task §4).
 *
 * Receipt lookup, key-window validation and assistant/topic ownership checks
 * already ran in `admitTurn` / `prepare*`; the transaction performs no model,
 * storage or compression call.
 */
async function acceptTurn(
  prepared: PreparedTurn,
  actor: Actor,
  options: { requestId?: string; requestExpiresAt: Date | null },
): Promise<AdmittedGeneration> {
  const db = getDb();
  const { requestId, requestExpiresAt } = options;

  const assistantMessageId = newId();
  const input: ChatGenerationInput = {
    assistantId: prepared.assistantId,
    topicId: prepared.topicId ?? "",
    providerConfigId: prepared.providerConfigId,
    modelId: prepared.modelId,
    ...(prepared.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: prepared.reasoningEffort }),
    ...(prepared.searchMode === undefined
      ? {}
      : { searchMode: prepared.searchMode }),
    ...(prepared.image === undefined ? {} : { image: prepared.image }),
    ...(prepared.timeZone === undefined ? {} : { timeZone: prepared.timeZone }),
    historyMessageIds: prepared.historyMessageIds,
    ...(prepared.userMessage === undefined
      ? {}
      : { userMessageId: prepared.userMessage.message.id }),
    ...(prepared.targetMessageId === undefined
      ? {}
      : { targetMessageId: prepared.targetMessageId }),
    ...(prepared.assistantGroupId === undefined
      ? {}
      : { assistantGroupId: prepared.assistantGroupId }),
    ...(prepared.assistantGroupCreatedAt === undefined
      ? {}
      : {
          assistantGroupCreatedAt: prepared.assistantGroupCreatedAt.toISOString(),
        }),
    defaultTopicTitle: prepared.defaultTopicTitle,
    titleCandidate: prepared.titleCandidate,
    actorRole: prepared.actorRole,
    actorIsGuest: prepared.actorIsGuest,
    ...(prepared.locale === undefined ? {} : { locale: prepared.locale }),
    ...(prepared.systemPrompt === undefined
      ? {}
      : { systemPrompt: prepared.systemPrompt }),
    ...(prepared.summary === undefined ? {} : { summary: prepared.summary }),
  };

  // Row timestamps come from the Node clock (project rule: one app clock per
  // topic), never from the database default or the TTL clock.
  const now = new Date();
  // The placeholder must sort strictly after the user message it answers:
  // both rows are accepted in this transaction, and a tie on createdAt would
  // let the id tie-break place the empty answer slot before the question.
  const messageTime = now;
  const placeholderTime = new Date(now.getTime() + 1);
  let createdTopicId: string | null = null;
  let duplicate: GenerationRow | null = null;
  try {
    const row = await db.transaction(async (tx) => {
      let topicId = prepared.topicId;
      if (topicId === null) {
        // Fresh topic: no parent lock needed, the id is new.
        const { result } = await insertWithShortId({
          mint: newTopicId,
          insert: (id) =>
            tx
              .insert(topics)
              .values({
                id,
                assistantId: prepared.assistantId,
                title: prepared.defaultTopicTitle,
              })
              .returning({ id: topics.id }),
        });
        topicId = result[0]?.id ?? null;
        createdTopicId = topicId;
        if (topicId === null) {
          throw new AppError("INTERNAL", 500, "topic.createFailed");
        }
      } else {
        // Parent lock: the single-active-turn rule serializes on the topic row,
        // in the same parent→child order the delete paths use.
        const locked = await tx
          .select({
            id: topics.id,
            summaryUpToMessageId: topics.summaryUpToMessageId,
          })
          .from(topics)
          .where(eq(topics.id, topicId))
          .for("update");
        const lockedTopic = locked[0];
        if (!lockedTopic) {
          throw new AppError("NOT_FOUND", 404, "topic.notFound");
        }
        if (requestId) {
          // Re-check the receipt under the lock: two tabs retrying the SAME
          // request id both miss the pre-transaction lookup, and only one of
          // them will hold the lock. Without this the loser would report a
          // topic conflict instead of returning the winner's task.
          const receipt = await tx
            .select()
            .from(chatGenerations)
            .where(
              and(
                eq(chatGenerations.userId, actor.userId),
                eq(chatGenerations.requestId, requestId),
              ),
            )
            .limit(1);
          if (receipt[0]) {
            assertReceiptMatches(receipt[0], prepared.requestHash);
            duplicate = receipt[0];
            return receipt[0];
          }
        }
        // The context the turn was prepared against is validated HERE, inside
        // the lock: another context mutation (version switch, delete, manual
        // compaction) or a previous turn may have completed between
        // preparation and admission.
        await assertFrozenContextValid(
          tx,
          topicId,
          lockedTopic.summaryUpToMessageId,
          prepared,
        );
        const active = await tx
          .select({ id: chatGenerations.id })
          .from(chatGenerations)
          .where(
            and(
              eq(chatGenerations.topicId, topicId),
              inArray(chatGenerations.status, [...ACTIVE_GENERATION_STATUSES]),
            ),
          )
          .limit(1);
        if (active.length > 0) {
          throw new AppError("CONFLICT", 409, "generation.topicBusy");
        }
      }

      if (actor.isGuest) {
        // Serialize concurrent sends across a guest's topics and enforce
        // at most one active generation per guest + daily/global quotas.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, actor.userId))
          .for("update");
        const guestActive = await tx
          .select({ id: chatGenerations.id })
          .from(chatGenerations)
          .where(
            and(
              eq(chatGenerations.userId, actor.userId),
              inArray(chatGenerations.status, [...ACTIVE_GENERATION_STATUSES]),
            ),
          )
          .limit(1);
        if (guestActive.length > 0) {
          throw new AppError("CONFLICT", 409, "demo.busy");
        }
        await consumeGuestModelTurnQuota(actor.userId, tx);
      }

      if (prepared.userMessage) {
        const message = prepared.userMessage.message as never;
        if (prepared.userMessage.versionOfGroupId) {
          await insertUserMessageVersionRow(tx, {
            topicId,
            groupId: prepared.userMessage.versionOfGroupId,
            message,
            createdAt: messageTime,
          });
        } else {
          await insertUserMessageRow(tx, {
            topicId,
            message,
            createdAt: messageTime,
          });
        }
      }

      await insertAssistantRow(tx, {
        topicId,
        id: assistantMessageId,
        parts: [],
        outcome: null,
        createdAt: placeholderTime,
        groupId: prepared.assistantGroupId,
        groupCreatedAt: prepared.assistantGroupCreatedAt,
      });

      const inserted = await tx
        .insert(chatGenerations)
        .values({
          id: newId(),
          userId: actor.userId,
          requestId: requestId ?? null,
          requestHash: prepared.requestHash,
          requestExpiresAt,
          kind: prepared.kind,
          status: "queued",
          topicId,
          assistantMessageId,
          input: { ...input, topicId },
          createdAt: placeholderTime,
          updatedAt: placeholderTime,
        })
        .returning();
      const generation = inserted[0];
      if (!generation) {
        throw new AppError("INTERNAL", 500, "generation.createFailed");
      }
      return generation;
    });
    if (duplicate !== null) {
      return { generation: duplicate, duplicate: true };
    }
    logger.info(
      {
        userId: actor.userId,
        generationId: row.id,
        topicId: row.topicId,
        kind: row.kind,
      },
      "generation admitted",
    );
    return { generation: row, duplicate: false };
  } catch (caught) {
    if (!isUniqueViolation(caught)) {
      throw caught;
    }
    // Two races survive the topic lock:
    // - the same request id admitted concurrently (the loser returns the
    //   winner's task instead of running the model twice);
    // - a topic slot taken between the lock release and the insert.
    if (requestId) {
      const existing = await findGenerationByRequestId(requestId, actor);
      if (existing) {
        // Same duplicate rules as the pre-flight lookup, including a target
        // that was deleted while the winner was being admitted.
        assertReceiptMatches(existing, prepared.requestHash);
        return { generation: existing, duplicate: true };
      }
    }
    if (createdTopicId !== null) {
      // Nothing should be left behind by a failed admission of a fresh topic.
      throw caught;
    }
    throw new AppError("CONFLICT", 409, "generation.topicBusy");
  }
}

/**
 * In-lock validation of everything `prepare*` froze (chat task §4 step 4):
 *
 * - every frozen history id still exists — a deleted message would change the
 *   context the answer is generated from;
 * - the clicked regenerate target still exists;
 * - the compression boundary did not move — a manual compaction that finished
 *   in between would make the frozen clipping (and its summary) stale.
 *
 * Any mismatch is a conflict: the client has to re-prepare against the current
 * context instead of generating an answer the server can no longer justify.
 */
async function assertFrozenContextValid(
  tx: DbTransaction,
  topicId: string,
  summaryUpToMessageId: string | null,
  prepared: PreparedTurn,
): Promise<void> {
  const frozenSummaryBoundary = prepared.summary?.boundaryMessageId ?? null;
  if (frozenSummaryBoundary !== summaryUpToMessageId) {
    throw new AppError("CONFLICT", 409, "generation.contextChanged");
  }

  const ids = [...prepared.historyMessageIds];
  if (prepared.targetMessageId) {
    ids.push(prepared.targetMessageId);
  }
  if (ids.length === 0) {
    return;
  }
  const rows = await tx
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(
      and(eq(chatMessages.topicId, topicId), inArray(chatMessages.id, ids)),
    );
  const present = new Set(rows.map((row) => row.id));
  for (const id of ids) {
    if (!present.has(id)) {
      throw new AppError("CONFLICT", 409, "generation.contextChanged");
    }
  }
}

// --- Execution transitions -------------------------------------------------

/**
 * queued → running. A conditional update is the whole "claim" mechanism: a
 * duplicate wake-up in the same process, or two processes racing on the same
 * row, cannot both win, so the model is called at most once.
 */
export async function claimGeneration(
  id: string,
): Promise<GenerationRow | null> {
  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(chatGenerations)
    .set({ status: "running", startedAt: now, updatedAt: now })
    .where(
      and(
        eq(chatGenerations.id, id),
        eq(chatGenerations.status, "queued"),
        sql`${chatGenerations.targetDeletedAt} is null`,
      ),
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * running/queued → stopping; idempotent for already-terminal rows.
 *
 * The transition is a conditional update on the ACTIVE statuses, not a plain
 * `WHERE id/userId`: a stop that arrives after the turn completed must not
 * move a terminal row back to `stopping`, which would leave the topic looking
 * like it is still generating (chat task §5).
 */
export async function markGenerationStopping(
  id: string,
  actor: Actor,
): Promise<GenerationRow> {
  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(chatGenerations)
    .set({ status: "stopping", updatedAt: now })
    .where(
      and(
        eq(chatGenerations.id, id),
        eq(chatGenerations.userId, actor.userId),
        inArray(chatGenerations.status, [...ACTIVE_GENERATION_STATUSES]),
      ),
    )
    .returning();
  const stopping = updated[0];
  if (stopping) {
    return stopping;
  }
  // Already terminal (or gone): return the authoritative row so the caller can
  // tell "nothing left to cancel" from "cancelled now".
  const current = await findGenerationForActor(id, actor);
  if (!current) {
    throw new AppError("NOT_FOUND", 404, "generation.notFound");
  }
  return current;
}

/**
 * Current durable status of one task, read after a successful claim so a stop
 * that committed in between cannot be missed (chat task §5).
 */
export async function currentGenerationStatus(
  id: string,
): Promise<GenerationStatus | null> {
  const db = getDb();
  const rows = await db
    .select({ status: chatGenerations.status })
    .from(chatGenerations)
    .where(eq(chatGenerations.id, id))
    .limit(1);
  return rows[0]?.status ?? null;
}

/**
 * Crash-retention write of the answer currently streaming (chat task §3).
 *
 * Only `chat_messages` is touched: a checkpoint is not user activity, so it
 * must not move `topics.updatedAt` and reorder the sidebar every 10 seconds.
 * Usage/reasoning metadata rides along so a failed process keeps the feedback
 * the answer had already earned, not just its text.
 */
export async function checkpointGeneration(
  input: AssistantTurnWrite,
): Promise<boolean> {
  return writeAssistantTurnRow(getDb(), input);
}

export type TerminalGenerationStatus = Extract<
  GenerationStatus,
  "completed" | "stopped" | "failed" | "interrupted"
>;

export type FinalizeGenerationInput = {
  id: string;
  /** Target ids as the executor last saw them; null after a delete. */
  topicId: string | null;
  assistantMessageId: string | null;
  status: TerminalGenerationStatus;
  errorMessage?: string | null;
  /**
   * Terminal content. Omitted (or null) when nothing should be written — a
   * turn that never produced output, or a target that no longer exists.
   */
  message?: AssistantTurnWrite | null;
  /** Image batches commit no parts when cancellation wins the terminal race. */
  discardPartsOnStop?: boolean;
};

export type FinalizeResult = {
  /** This call performed the active → terminal transition. */
  settled: boolean;
  /** The final content is committed onto the placeholder row. */
  messageStored: boolean;
  /** The topic/assistant is gone: late output must be discarded. */
  targetDeleted: boolean;
  /**
   * The task's status after this call: the status this call committed, or the
   * status another writer already had. Callers use it to tell "the answer is
   * durable" from "the turn ended without content" — a lost acknowledgement
   * followed by a retry sees `completed` here even though THIS call stored
   * nothing, and the produced files must not be reclaimed.
   */
  status?: TerminalGenerationStatus;
};

/**
 * The single decision point for "this turn ends now" (chat task §5/§8).
 *
 * One transaction locks the parent topic row first (the same parent→child
 * order admission and the delete paths use), then the generation row, then
 * writes the placeholder content and the terminal task state together. That
 * makes stop / finalize / delete mutually exclusive instead of three separate
 * statements that can interleave: whoever commits first wins, the loser
 * writes nothing, and a terminal row is never overwritten.
 *
 * The caller must only publish the finished stream after this returns
 * `settled: true` (chat task §3 — no success signal without a stored answer).
 */
export async function finalizeGeneration(
  input: FinalizeGenerationInput,
): Promise<FinalizeResult> {
  const db = getDb();
  const now = new Date();
  const terminal = {
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    updatedAt: now,
    finishedAt: now,
    // Terminal rows keep their receipt (requestHash) for the dedupe window
    // but drop everything the executor no longer needs.
    input: null,
  } as const;

  return db.transaction(async (tx) => {
    if (input.topicId !== null) {
      const lockedTopic = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.id, input.topicId))
        .for("update");
      if (lockedTopic.length === 0) {
        // Parent already deleted: its transaction settled the task. Keep the
        // task from lingering as active if it somehow was not (idempotent).
        await tx
          .update(chatGenerations)
          .set(terminal)
          .where(
            and(
              eq(chatGenerations.id, input.id),
              inArray(chatGenerations.status, [
                ...ACTIVE_GENERATION_STATUSES,
              ]),
            ),
          );
        return { settled: false, messageStored: false, targetDeleted: true };
      }
    }

    const rows = await tx
      .select({
        status: chatGenerations.status,
        targetDeletedAt: chatGenerations.targetDeletedAt,
      })
      .from(chatGenerations)
      .where(eq(chatGenerations.id, input.id))
      .for("update");
    const current = rows[0];
    if (!current) {
      return { settled: false, messageStored: false, targetDeleted: true };
    }
    if (!isActiveGenerationStatus(current.status as GenerationStatus)) {
      // Another writer (delete, boot recovery, earlier stop/finalize) already
      // closed this task. Never overwrite a terminal state; report what it is,
      // so a retried terminal write can tell a committed answer (its own lost
      // acknowledgement) from a turn that ended without content.
      return {
        settled: false,
        messageStored: false,
        targetDeleted: current.targetDeletedAt !== null,
        status: current.status as TerminalGenerationStatus,
      };
    }

    const targetDeleted =
      current.targetDeletedAt !== null ||
      input.topicId === null ||
      input.assistantMessageId === null;
    // A stop can commit after the producer computed "completed" but before
    // this transaction acquired the task lock. Never overwrite that decision
    // with stale local state (including an error arriving after cancellation).
    const status = current.status === "stopping" ? "stopped" : input.status;
    const errorMessage = status === "stopped" ? null : terminal.errorMessage;
    const message = input.message && status === "stopped"
      ? {
          ...input.message,
          outcome: "stopped" as const,
          errorMessage: null,
          ...(input.discardPartsOnStop ? { parts: [] } : {}),
        }
      : input.message;
    const messageStored =
      !targetDeleted && message !== null && message !== undefined
        ? await writeAssistantTurnRow(tx, message)
        : false;

    await tx
      .update(chatGenerations)
      .set({ ...terminal, status, errorMessage })
      .where(eq(chatGenerations.id, input.id));

    if (input.topicId !== null && !targetDeleted) {
      // The row is already locked above, so this cannot deadlock with
      // admission (same topic → generation order).
      await tx
        .update(topics)
        .set({ updatedAt: now })
        .where(eq(topics.id, input.topicId));
    }

    return { settled: true, messageStored, targetDeleted, status };
  });
}

/**
 * Boot/shutdown recovery (chat task §5, R9): a previous process cannot have
 * completed these turns, and re-running them would repeat reasoning/tool side
 * effects, so they are closed with what is already persisted.
 *
 * The message rows are closed in the same transaction as the task: history is
 * what the user reads, so a leftover `running` row that only updated
 * `chat_generations` would still render as "generating" forever. The content
 * already checkpointed is kept; only outcome/error are set, with the
 * interruption text localized in the locale captured at admission.
 */
export async function recoverInterruptedGenerations(): Promise<{
  interrupted: number;
  stopped: number;
}> {
  const db = getDb();
  const rows = await db
    .select({
      id: chatGenerations.id,
      status: chatGenerations.status,
      topicId: chatGenerations.topicId,
      assistantMessageId: chatGenerations.assistantMessageId,
      input: chatGenerations.input,
    })
    .from(chatGenerations)
    .where(inArray(chatGenerations.status, ["running", "stopping"]));

  const translators = new Map<string, ErrorsTranslator>();
  let interrupted = 0;
  let stopped = 0;
  for (const row of rows) {
    const wasRunning = row.status === "running";
    let errorMessage: string | null = null;
    if (wasRunning) {
      const locale = row.input?.locale ?? "";
      let translator = translators.get(locale);
      if (!translator) {
        translator = await errorsTranslatorFor(row.input?.locale);
        translators.set(locale, translator);
      }
      errorMessage = translator("generation.interrupted");
    }
    const hasTarget =
      row.topicId !== null && row.assistantMessageId !== null;
    const result = await finalizeGeneration({
      id: row.id,
      topicId: row.topicId,
      assistantMessageId: row.assistantMessageId,
      status: wasRunning ? "interrupted" : "stopped",
      errorMessage,
      message: hasTarget
        ? {
            topicId: row.topicId!,
            messageId: row.assistantMessageId!,
            outcome: wasRunning ? "failed" : "stopped",
            errorMessage,
          }
        : null,
    });
    if (!result.settled) {
      continue;
    }
    if (wasRunning) {
      interrupted += 1;
    } else {
      stopped += 1;
    }
    logger.warn(
      {
        generationId: row.id,
        topicId: row.topicId,
        status: wasRunning ? "interrupted" : "stopped",
      },
      "leftover generation closed after a process restart",
    );
  }
  return { interrupted, stopped };
}

/**
 * G2 receipt cleanup: terminal rows are deleted once BOTH the 24h post-finish
 * window and their own request window have passed. Deleting the receipt never
 * touches messages, so chat history stays readable; a recycled old request id
 * still fails the key-age check because its timestamp is in the past.
 */
export async function purgeTerminalGenerations(
  clock: Clock = databaseNow,
): Promise<number> {
  const db = getDb();
  const now = await clock();
  const cutoff = new Date(now.getTime() - REQUEST_KEY_TTL_MS);
  const deleted = await db
    .delete(chatGenerations)
    .where(
      and(
        inArray(chatGenerations.status, [
          "completed",
          "stopped",
          "failed",
          "interrupted",
        ]),
        lt(chatGenerations.finishedAt, cutoff),
        or(
          sql`${chatGenerations.requestExpiresAt} is null`,
          lt(chatGenerations.requestExpiresAt, now),
        ),
      ),
    )
    .returning({ id: chatGenerations.id });
  return deleted.length;
}

/** Actor for a background turn: identity + role + guest flag captured at admission. */
export function generationActor(row: GenerationRow): Actor {
  return {
    userId: row.userId,
    role: (row.input?.actorRole ?? "user") as ActorRole,
    isGuest: row.input?.actorIsGuest === true,
  };
}

export type { DbTransaction };
