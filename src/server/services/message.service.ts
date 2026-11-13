import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { newId } from "@/lib/id";
import {
  chatStoredPartSchema,
  type ChatMessageOutcome,
  type ChatMetadata,
  type ChatUIMessage,
} from "@/lib/schemas/chat";
import type { Actor } from "@/server/auth/actor";
import { getDb, type DbTransaction } from "@/server/db/client";
import { chatMessages, topics } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import {
  deleteFilesIfUnreferenced,
  fileIdsFromParts,
} from "@/server/files/file.service";
import { lockTopicAndAssertIdle } from "@/server/services/generation-target.service";
import { findTopicContextForActor } from "@/server/services/topic.service";

type ChatMessageRow = typeof chatMessages.$inferSelect;

/** Per-item parse so one unrecognised part cannot discard the whole message. */
export function uiPartsFromJson(value: unknown): ChatUIMessage["parts"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const parsed = chatStoredPartSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Per-phase reasoning durations persisted on the reasoning parts themselves
 * (zipped in at stream end — see withReasoningDurations). Undefined when no
 * part carries a duration, so legacy rows fall back to the reasoningMs
 * column for their single block.
 */
function reasoningDurationsFromParts(parts: unknown): number[] | undefined {
  if (!Array.isArray(parts)) {
    return undefined;
  }
  const durations = parts.flatMap((item) => {
    const parsed = chatStoredPartSchema.safeParse(item);
    return parsed.success &&
      parsed.data.type === "reasoning" &&
      parsed.data.durationMs !== undefined
      ? [parsed.data.durationMs]
      : [];
  });
  return durations.length > 0 ? durations : undefined;
}

export function metadataFromRow(row: {
  role: ChatMessageRow["role"];
  outcome: ChatMessageRow["outcome"];
  errorMessage: ChatMessageRow["errorMessage"];
  providerConfigId: ChatMessageRow["providerConfigId"];
  modelId: ChatMessageRow["modelId"];
  reasoningMs: ChatMessageRow["reasoningMs"];
  totalTokens?: ChatMessageRow["totalTokens"];
  finishReason?: ChatMessageRow["finishReason"];
  translations: ChatMessageRow["translations"];
  createdAt: ChatMessageRow["createdAt"];
  parts?: unknown;
}): ChatMetadata | undefined {
  // Translations are per-row (per version), exposed for both roles.
  const translations = row.translations ?? undefined;
  if (row.role !== "assistant") {
    return { createdAt: row.createdAt.toISOString(), translations };
  }
  return {
    outcome: row.outcome ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    providerConfigId: row.providerConfigId ?? undefined,
    modelId: row.modelId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    reasoningMs: row.reasoningMs ?? undefined,
    reasoningDurations: reasoningDurationsFromParts(row.parts),
    // Persisted usage/finish feedback (chat task R7): without these a reload
    // loses the "truncated by output limit" hint the live stream announced.
    ...(row.totalTokens === null || row.totalTokens === undefined
      ? {}
      : { totalTokens: row.totalTokens }),
    ...(row.finishReason === null || row.finishReason === undefined
      ? {}
      : { finishReason: row.finishReason }),
    translations,
  };
}

/** Version metadata attached to the selected message of a group. */
export type VersionInfo = {
  groupId: string;
  /** 1-based position of this version within the group. */
  versionIndex: number;
  versionCount: number;
  /** All version ids in the group, oldest first. */
  versionIds: string[];
};

export function rowToChatUIMessage(
  row: ChatMessageRow,
  version?: VersionInfo,
): ChatUIMessage {
  const metadata = metadataFromRow(row);
  return {
    id: row.id,
    role: row.role,
    parts: uiPartsFromJson(row.parts),
    // Version metadata rides on every role: editing a user message turns
    // its group multi-version too, and the switcher is role-agnostic.
    metadata: version ? { ...metadata, ...version } : metadata,
  };
}

export function textFromMessage(message: ChatUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

async function requireOwnedTopic(
  topicId: string,
  actor: Actor,
  tx?: DbTransaction,
): Promise<void> {
  const context = await findTopicContextForActor(topicId, actor, { tx });
  if (!context) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
}

/**
 * Groups rows (already ordered by createdAt, id) by groupId and returns the
 * groups in stable position order: each group sorts by its `groupCreatedAt`
 * anchor, which is set at group creation and inherited by every version, so
 * deleting a group's earliest version never shifts the group's place in the
 * topic. Ties (a detached regenerate inherits the target group's anchor) break
 * by the group's earliest remaining row, keeping the inherited group right
 * after the group it sprang from. Within a group, versions stay in
 * (createdAt, id) order — `versionInfoOf` relies on it.
 */
function groupRows(rows: ChatMessageRow[]): ChatMessageRow[][] {
  const byGroup = new Map<string, ChatMessageRow[]>();
  for (const row of rows) {
    const group = byGroup.get(row.groupId);
    if (group) {
      group.push(row);
    } else {
      byGroup.set(row.groupId, [row]);
    }
  }
  const groups = [...byGroup.values()];
  groups.sort((a, b) => {
    // Groups are built from rows: every group has at least one element.
    const first = a[0]!;
    const second = b[0]!;
    const anchorDiff =
      first.groupCreatedAt.getTime() - second.groupCreatedAt.getTime();
    if (anchorDiff !== 0) {
      return anchorDiff;
    }
    const createdDiff = first.createdAt.getTime() - second.createdAt.getTime();
    if (createdDiff !== 0) {
      return createdDiff;
    }
    return first.groupId.localeCompare(second.groupId);
  });
  return groups;
}

/** Selected version of a group; falls back to the latest version. */
function selectedRowOf(group: ChatMessageRow[]): ChatMessageRow {
  const selected =
    group.find((row) => row.isSelected) ?? group[group.length - 1];
  if (!selected) {
    throw new AppError("INTERNAL", 500, "message.emptyVersionGroup");
  }
  return selected;
}

function versionInfoOf(
  group: ChatMessageRow[],
  selected: ChatMessageRow,
): VersionInfo {
  const versionIds = group.map((row) => row.id);
  return {
    groupId: selected.groupId,
    versionIndex: versionIds.indexOf(selected.id) + 1,
    versionCount: group.length,
    versionIds,
  };
}

/**
 * Version metadata of one message, read by the executor when it starts a turn.
 *
 * A live answer replaces the placeholder row on the client, so the state it
 * announces must carry the same group/version identity the seeded history had;
 * otherwise the resumed message loses its position anchor and version switcher
 * (the message list is keyed by `groupId`). No ownership check: the ids come
 * from the generation row the executor already resolved.
 */
export async function messageVersionMetadata(
  topicId: string,
  messageId: string,
): Promise<VersionInfo | null> {
  const rows = await listTopicRows(topicId);
  const target = rows.find((row) => row.id === messageId);
  if (!target) {
    return null;
  }
  const group = rows.filter((row) => row.groupId === target.groupId);
  return versionInfoOf(group, target);
}

async function listTopicRows(topicId: string): Promise<ChatMessageRow[]> {
  const db = getDb();
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.topicId, topicId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
}

/**
 * History-compression lock (PRD R10): messages inside the compressed zone are
 * immutable. Ownership is already established by the caller (`requireOwnedTopic`),
 * so this reads the boundary straight from `topics` — intentionally not via
 * compression.service, which imports this module and would create a cycle.
 *
 * Group semantics mirror the compression boundary: a target in the boundary's
 * own version group, or in any earlier group, is locked. An unresolvable
 * boundary id locks nothing — the same fallback `messagesAfterBoundary` uses.
 */
async function assertTargetNotCompressed(
  topicId: string,
  targetId: string,
  knownGroups?: ChatMessageRow[][],
): Promise<void> {
  const db = getDb();
  const boundaryRows = await db
    .select({ summaryUpToMessageId: topics.summaryUpToMessageId })
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1);
  const boundaryId = boundaryRows[0]?.summaryUpToMessageId ?? null;
  if (!boundaryId) {
    return;
  }
  const groups = knownGroups ?? groupRows(await listTopicRows(topicId));
  const boundaryIndex = groups.findIndex((group) =>
    group.some((row) => row.id === boundaryId),
  );
  if (boundaryIndex < 0) {
    return;
  }
  const targetIndex = groups.findIndex((group) =>
    group.some((row) => row.id === targetId),
  );
  if (targetIndex >= 0 && targetIndex <= boundaryIndex) {
    throw new AppError("CONFLICT", 409, "message.compressedLocked");
  }
}

/**
 * Returns the selected-version view of a topic: one message per version group
 * (the group's `isSelected` row, or the latest version when nothing is
 * selected), ordered by each group's earliest version. Every message carries
 * version metadata; single-version groups return exactly what the
 * pre-grouping query returned, plus that metadata.
 */
export async function listTopicMessages(
  input: { topicId: string },
  actor: Actor,
): Promise<ChatUIMessage[]> {
  await requireOwnedTopic(input.topicId, actor);
  const rows = await listTopicRows(input.topicId);
  return groupRows(rows).map((group) => {
    const selected = selectedRowOf(group);
    return rowToChatUIMessage(selected, versionInfoOf(group, selected));
  });
}

/**
 * Loads specific message versions in the given order. Admission freezes the
 * ids of the selected-version history a turn runs against, so the executor
 * reads exactly that context later even if the user has meanwhile switched
 * versions (the frozen ids are the contract, R6).
 */
export async function loadMessagesByIds(
  input: { topicId: string; ids: string[] },
  actor: Actor,
): Promise<ChatUIMessage[]> {
  await requireOwnedTopic(input.topicId, actor);
  if (input.ids.length === 0) {
    return [];
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.topicId, input.topicId),
        inArray(chatMessages.id, input.ids),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return input.ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [rowToChatUIMessage(row)] : [];
  });
}

type UserMessageInsertInput = {
  topicId: string;
  message: ChatUIMessage;
  createdAt?: Date;
};

type UserMessageVersionInsertInput = {
  topicId: string;
  /** Existing USER group the new version joins. */
  groupId: string;
  message: ChatUIMessage;
  createdAt?: Date;
};

/**
 * Shared underlying user-message writer (no topic ownership check).
 * Callers must establish topic ownership before invoking this writer:
 * the public wrapper uses `requireOwnedTopic`; admission uses `prepare*`.
 */
export async function insertUserMessageRow(
  executor: DbTransaction | ReturnType<typeof getDb>,
  input: UserMessageInsertInput,
): Promise<ChatUIMessage> {
  const id = input.message.id.length > 0 ? input.message.id : newId();
  // Attachments ride along in the persisted parts so the history keeps the
  // file references the UI renders; the model payload is routed separately at
  // send time (`resolveAttachmentsForModel`).
  const parts = input.message.parts.filter(
    (part) => part.type === "text" || part.type === "file",
  );
  const inserted = await executor
    .insert(chatMessages)
    .values({
      id,
      topicId: input.topicId,
      role: "user",
      parts,
      // User messages are always single-version groups keyed by their own id.
      groupId: id,
      // Caller passes the app-side turn-start time so every row in a topic
      // shares one clock; the DB default would mix in the Postgres clock,
      // whose drift (e.g. Docker/WSL2) can invert list ordering against the
      // app-timestamped assistant rows.
      ...(input.createdAt
        ? // New group: anchor to the row's own createdAt (single app clock);
          // when omitted both fall back to the same statement's now() default.
          { createdAt: input.createdAt, groupCreatedAt: input.createdAt }
        : {}),
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "message.storeFailed");
  }
  return rowToChatUIMessage(row);
}

export async function appendUserMessage(
  input: UserMessageInsertInput,
  actor: Actor,
  options?: { tx?: DbTransaction },
): Promise<ChatUIMessage> {
  await requireOwnedTopic(input.topicId, actor, options?.tx);
  return insertUserMessageRow(options?.tx ?? getDb(), input);
}

/**
 * Shared underlying user-version writer (no topic ownership check).
 * Validates that the target group is a user group, deselects siblings and
 * inserts the new selected version in one transaction. Callers must establish
 * topic ownership before invoking this writer.
 */
export async function insertUserMessageVersionRow(
  executor: DbTransaction | ReturnType<typeof getDb>,
  input: UserMessageVersionInsertInput,
): Promise<ChatUIMessage> {
  const groupRows = await executor
    .select({
      role: chatMessages.role,
      groupCreatedAt: chatMessages.groupCreatedAt,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.topicId, input.topicId),
        eq(chatMessages.groupId, input.groupId),
      ),
    )
    .limit(1);
  // Editing applies to user messages only; an unknown group and a non-user
  // group are indistinguishable to the caller.
  if (groupRows[0]?.role !== "user") {
    throw new AppError("NOT_FOUND", 404, "message.notFound");
  }
  const id = input.message.id.length > 0 ? input.message.id : newId();
  const parts = input.message.parts.filter(
    (part) => part.type === "text" || part.type === "file",
  );
  const row = await executor.transaction(async (tx) => {
    await tx
      .update(chatMessages)
      .set({ isSelected: false })
      .where(
        and(
          eq(chatMessages.topicId, input.topicId),
          eq(chatMessages.groupId, input.groupId),
        ),
      );
    const inserted = await tx
      .insert(chatMessages)
      .values({
        id,
        topicId: input.topicId,
        role: "user",
        parts,
        groupId: input.groupId,
        // App-side turn time, same single-clock rule as appendUserMessage.
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        // The version inherits the group's position anchor (verified to
        // exist by the role check above).
        groupCreatedAt: groupRows[0]!.groupCreatedAt,
      })
      .returning();
    return inserted[0];
  });
  if (!row) {
    throw new AppError("INTERNAL", 500, "message.storeFailed");
  }
  return rowToChatUIMessage(row);
}

/**
 * Edit-and-regenerate: appends a new SELECTED version to an existing user
 * group. The deselect and the insert share one transaction so the partial
 * unique index (`chat_messages_selected_version_idx`) never sees two selected
 * versions of the group — the same contract as appendAssistantMessage's group
 * branch.
 */
export async function appendUserMessageVersion(
  input: UserMessageVersionInsertInput,
  actor: Actor,
  options?: { tx?: DbTransaction },
): Promise<ChatUIMessage> {
  await requireOwnedTopic(input.topicId, actor, options?.tx);
  return insertUserMessageVersionRow(options?.tx ?? getDb(), input);
}

type AssistantMessageInsert = {
  topicId: string;
  /** Pre-allocated row id (the generation's assistant message identity). */
  id: string;
  parts: ChatUIMessage["parts"];
  /** null while the answer is still being generated (placeholder row). */
  outcome: ChatMessageOutcome | null;
  errorMessage?: string | null;
  providerConfigId?: string;
  modelId?: string;
  reasoningMs?: number;
  totalTokens?: number;
  finishReason?: string;
  createdAt?: Date;
  /** Existing group to add a version to; omit for a new single-version group. */
  groupId?: string;
  /**
   * Position anchor for a NEW group (ignored when `groupId` joins an existing
   * group, which always inherits the group's own anchor). Regeneration passes
   * the clicked message's group anchor when the answer slot was deleted empty,
   * so the new group lands back at the slot's position instead of sorting to
   * the end of the topic.
   */
  groupCreatedAt?: Date;
};

/**
 * Inserts one assistant row, handling the version-group rules:
 *
 * - joining an existing group deselects its siblings and inherits the group's
 *   position anchor in the same transaction (partial unique index on
 *   `is_selected`);
 * - opening a new group anchors it to the explicit override or the row's own
 *   createdAt (one app-side clock per topic).
 *
 * Both the placeholder written at admission and the final answer written at
 * finalize go through here, so the row identity never changes mid-turn.
 * Callers must establish topic ownership before invoking this writer.
 */
export async function insertAssistantRow(
  executor: DbTransaction | ReturnType<typeof getDb>,
  input: AssistantMessageInsert,
): Promise<ChatUIMessage> {
  const values = {
    id: input.id,
    topicId: input.topicId,
    role: "assistant" as const,
    parts: input.parts,
    outcome: input.outcome,
    errorMessage: input.errorMessage ?? null,
    providerConfigId: input.providerConfigId,
    modelId: input.modelId,
    // Undefined falls back to the column default (null / defaultNow());
    // createdAt is the turn-start time so a reloaded history shows the same
    // value the live stream announced.
    reasoningMs: input.reasoningMs,
    totalTokens: input.totalTokens,
    finishReason: input.finishReason,
    createdAt: input.createdAt,
    groupId: input.groupId ?? input.id,
    // New group: anchor to the explicit override, else the row's own
    // createdAt (undefined lets both fall back to the same statement's
    // now() default). The existing-group branch overwrites this below.
    groupCreatedAt: input.groupCreatedAt ?? input.createdAt,
  };
  const existingGroupId = input.groupId;
  const row = existingGroupId
    ? // New version of an existing group: deselect siblings and insert the
      // new selected version atomically (partial unique index on the group).
      await executor.transaction(async (tx) => {
        await tx
          .update(chatMessages)
          .set({ isSelected: false })
          .where(
            and(
              eq(chatMessages.topicId, input.topicId),
              eq(chatMessages.groupId, existingGroupId),
            ),
          );
        // Inherit the group's position anchor from any sibling so the
        // version never re-anchors the group to its own createdAt.
        const siblings = await tx
          .select({ groupCreatedAt: chatMessages.groupCreatedAt })
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.topicId, input.topicId),
              eq(chatMessages.groupId, existingGroupId),
            ),
          )
          .limit(1);
        const inserted = await tx
          .insert(chatMessages)
          .values({
            ...values,
            // An empty group here is unreachable (resolveRegenerateTarget
            // only returns groups with rows); fall back to the precomputed
            // anchor rather than dropping the column.
            groupCreatedAt:
              siblings[0]?.groupCreatedAt ?? values.groupCreatedAt,
          })
          .returning();
        return inserted[0];
      })
    : (await executor.insert(chatMessages).values(values).returning())[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "message.storeFailed");
  }
  return rowToChatUIMessage(row);
}

export async function appendAssistantMessage(
  input: {
    topicId: string;
    message: ChatUIMessage;
    outcome: ChatMessageOutcome;
    errorMessage?: string | null;
    providerConfigId: string;
    modelId: string;
    reasoningMs?: number;
    totalTokens?: number;
    finishReason?: string;
    createdAt?: Date;
    groupId?: string;
    groupCreatedAt?: Date;
  },
  actor: Actor,
  options?: { tx?: DbTransaction },
): Promise<ChatUIMessage> {
  await requireOwnedTopic(input.topicId, actor, options?.tx);
  return insertAssistantRow(options?.tx ?? getDb(), {
    topicId: input.topicId,
    id: input.message.id.length > 0 ? input.message.id : newId(),
    parts: input.message.parts,
    outcome: input.outcome,
    errorMessage: input.errorMessage,
    providerConfigId: input.providerConfigId,
    modelId: input.modelId,
    reasoningMs: input.reasoningMs,
    totalTokens: input.totalTokens,
    finishReason: input.finishReason,
    createdAt: input.createdAt,
    groupId: input.groupId,
    groupCreatedAt: input.groupCreatedAt,
  });
}

/**
 * Admission-time assistant placeholder (chat task §3): the row that owns the
 * answer exists before the model is called, so the version/group slot, its
 * selected state and the message identity are fixed for the whole turn. The
 * executor later UPDATEs this same row with the produced parts.
 */
export async function insertAssistantPlaceholder(
  input: {
    topicId: string;
    id: string;
    createdAt?: Date;
    groupId?: string;
    groupCreatedAt?: Date;
  },
  actor: Actor,
  options?: { tx?: DbTransaction },
): Promise<ChatUIMessage> {
  await requireOwnedTopic(input.topicId, actor, options?.tx);
  return insertAssistantRow(options?.tx ?? getDb(), {
    topicId: input.topicId,
    id: input.id,
    parts: [],
    outcome: null,
    createdAt: input.createdAt,
    groupId: input.groupId,
    groupCreatedAt: input.groupCreatedAt,
  });
}

/**
 * Content of an admitted turn written onto its placeholder row — the periodic
 * checkpoint (partial content) and the terminal write share this shape.
 *
 * `parts` is omitted by a terminal write that must keep whatever content was
 * already persisted (a queued turn stopped before it produced anything, or a
 * recovery that only closes the row).
 */
export type AssistantTurnWrite = {
  topicId: string;
  messageId: string;
  parts?: ChatUIMessage["parts"];
  outcome?: ChatMessageOutcome | null;
  errorMessage?: string | null;
  providerConfigId?: string | null;
  modelId?: string | null;
  reasoningMs?: number;
  totalTokens?: number;
  finishReason?: string | null;
};

/**
 * Writes current/final content onto the placeholder row of an admitted turn.
 *
 * Runs on the caller's executor so the terminal write can join the generation
 * state transition in ONE transaction (chat task §5/§8). Deliberately does no
 * ownership/topic-activity work: the generation service owns the task identity
 * (the ids came from its own row) and decides whether `topics.updatedAt`
 * moves — a checkpoint must not reorder the sidebar, a terminal write may.
 *
 * Returns false when the row no longer exists (topic/message deleted while the
 * turn ran); the caller must then discard its output instead of re-creating it.
 */
export async function writeAssistantTurnRow(
  executor: DbTransaction | ReturnType<typeof getDb>,
  input: AssistantTurnWrite,
): Promise<boolean> {
  const updated = await executor
    .update(chatMessages)
    .set({
      ...(input.parts === undefined ? {} : { parts: input.parts }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.errorMessage === undefined
        ? {}
        : { errorMessage: input.errorMessage }),
      ...(input.providerConfigId === undefined
        ? {}
        : { providerConfigId: input.providerConfigId }),
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      ...(input.reasoningMs === undefined
        ? {}
        : { reasoningMs: input.reasoningMs }),
      ...(input.totalTokens === undefined
        ? {}
        : { totalTokens: input.totalTokens }),
      ...(input.finishReason === undefined
        ? {}
        : { finishReason: input.finishReason }),
    })
    .where(
      and(
        eq(chatMessages.id, input.messageId),
        eq(chatMessages.topicId, input.topicId),
        eq(chatMessages.role, "assistant"),
      ),
    )
    .returning({ id: chatMessages.id });
  return updated.length > 0;
}

export async function deleteMessage(
  input: { topicId: string; messageId: string },
  actor: Actor,
): Promise<{ deleted: true; groupEmpty: boolean }> {
  await requireOwnedTopic(input.topicId, actor);
  const db = getDb();
  // Attachment ids referenced by the row being removed, collected inside the
  // transaction so the post-commit cleanup sees the reference already gone.
  let releasedFileIds: string[] = [];
  const result = await db.transaction(async (tx) => {
    // A running turn owns the topic's context: deleting a message under it
    // would generate against a history that no longer exists (chat task §8).
    await lockTopicAndAssertIdle(tx, input.topicId);
    const targets = await tx
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.topicId, input.topicId),
          eq(chatMessages.id, input.messageId),
        ),
      )
      .limit(1);
    const target = targets[0];
    if (!target) {
      // Missing and foreign messages are indistinguishable to the caller.
      throw new AppError("NOT_FOUND", 404, "message.notFound");
    }
    // PRD R10: the compressed zone is immutable; check before deleting.
    await assertTargetNotCompressed(input.topicId, target.id);
    releasedFileIds = fileIdsFromParts(target.parts);
    await tx.delete(chatMessages).where(eq(chatMessages.id, target.id));
    const remaining = await tx
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.topicId, input.topicId),
          eq(chatMessages.groupId, target.groupId),
        ),
      )
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
    const groupEmpty = remaining.length === 0;
    const latest = remaining[remaining.length - 1];
    if (target.isSelected && latest) {
      // Fall back to the newest remaining version.
      await tx
        .update(chatMessages)
        .set({ isSelected: true })
        .where(eq(chatMessages.id, latest.id));
    }
    return { deleted: true as const, groupEmpty };
  });
  // After the row is gone so the reference check no longer sees it. Best-effort
  // by contract; a failure is reclaimed by the orphan sweeper later.
  await deleteFilesIfUnreferenced(releasedFileIds, actor);
  return result;
}

export async function selectMessageVersion(
  input: { topicId: string; messageId: string },
  actor: Actor,
): Promise<void> {
  await requireOwnedTopic(input.topicId, actor);
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockTopicAndAssertIdle(tx, input.topicId);
    const targets = await tx
      .select({ id: chatMessages.id, groupId: chatMessages.groupId })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.topicId, input.topicId),
          eq(chatMessages.id, input.messageId),
        ),
      )
      .limit(1);
    const target = targets[0];
    if (!target) {
      throw new AppError("NOT_FOUND", 404, "message.notFound");
    }
    // Deselect first so the partial unique index never sees two selected
    // versions of the same group.
    await tx
      .update(chatMessages)
      .set({ isSelected: false })
      .where(
        and(
          eq(chatMessages.topicId, input.topicId),
          eq(chatMessages.groupId, target.groupId),
        ),
      );
    await tx
      .update(chatMessages)
      .set({ isSelected: true })
      .where(eq(chatMessages.id, target.id));
  });
}

export type RegenerateTarget = {
  /** Group to append the new version to; null opens a new answer slot. */
  targetGroupId: string | null;
  /** Selected-version history the new version is generated from. */
  history: ChatUIMessage[];
  /**
   * The clicked message itself: role and its OWN version group (as opposed
   * to `targetGroupId`, which for a user target is the following answer's
   * group). Edit-and-regenerate needs both to validate and persist the edit.
   */
  target: {
    role: ChatMessageRow["role"];
    groupId: string;
    /**
     * Position anchor of the clicked message's own group. When
     * `targetGroupId` is null (the answer slot was deleted empty), the new
     * group inherits this anchor so the answer lands back where the slot
     * was instead of sorting to the end of the topic.
     */
    groupCreatedAt: Date;
  };
};

/**
 * Resolves what a regenerate request on `messageId` means:
 * - assistant message: add a version to its group; history is every selected
 *   message before that group.
 * - user message followed by an assistant group: add a version to that group;
 *   history runs through the user message.
 * - user message with no following assistant answer: new answer slot
 *   (targetGroupId null); history runs through the user message.
 */
export async function resolveRegenerateTarget(
  input: { topicId: string; messageId: string },
  actor: Actor,
): Promise<RegenerateTarget> {
  await requireOwnedTopic(input.topicId, actor);
  const rows = await listTopicRows(input.topicId);
  const target = rows.find((row) => row.id === input.messageId);
  if (!target) {
    throw new AppError("NOT_FOUND", 404, "message.notFound");
  }
  const groups = groupRows(rows);
  // PRD R10: regenerating inside the compressed zone would produce an answer
  // whose context the summary no longer reflects; reject it.
  await assertTargetNotCompressed(input.topicId, target.id, groups);
  const targetGroupIndex = groups.findIndex((group) =>
    group.some((row) => row.id === target.id),
  );
  const selectedView = (upToExclusive: number): ChatUIMessage[] =>
    groups.slice(0, upToExclusive).map((group) => {
      const selected = selectedRowOf(group);
      // Version metadata travels with the history so the compression
      // boundary can be matched by group rather than by the boundary row's
      // own (possibly deselected) id — same shape listTopicMessages returns.
      return rowToChatUIMessage(selected, versionInfoOf(group, selected));
    });

  // The clicked message itself (role + its OWN group, as opposed to
  // `targetGroupId`, which for a user target is the following answer's
  // group): edit-and-regenerate needs both to validate and persist the edit.
  const targetRef = {
    role: target.role,
    groupId: target.groupId,
    groupCreatedAt: target.groupCreatedAt,
  };

  if (target.role === "assistant") {
    return {
      targetGroupId: target.groupId,
      history: selectedView(targetGroupIndex),
      target: targetRef,
    };
  }

  const nextGroup = groups[targetGroupIndex + 1];
  const nextSelected = nextGroup ? selectedRowOf(nextGroup) : undefined;
  if (nextGroup && nextSelected?.role === "assistant") {
    return {
      targetGroupId: nextSelected.groupId,
      history: selectedView(targetGroupIndex + 1),
      target: targetRef,
    };
  }
  return {
    targetGroupId: null,
    history: selectedView(targetGroupIndex + 1),
    target: targetRef,
  };
}
