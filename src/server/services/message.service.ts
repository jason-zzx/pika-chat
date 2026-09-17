import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { newId } from "@/lib/id";
import {
  chatStoredPartSchema,
  type ChatMessageOutcome,
  type ChatMetadata,
  type ChatUIMessage,
} from "@/lib/schemas/chat";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { chatMessages, topics } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import {
  deleteFilesIfUnreferenced,
  fileIdsFromParts,
} from "@/server/files/file.service";
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
    translations,
  };
}

/** Version metadata attached to assistant messages of a group. */
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
    // Version metadata is assistant-only; user rows stay single-version.
    metadata:
      version && row.role === "assistant"
        ? { ...metadata, ...version }
        : metadata,
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
): Promise<void> {
  const context = await findTopicContextForActor(topicId, actor);
  if (!context) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
}

/**
 * Groups rows (already ordered by createdAt, id) by groupId, preserving the
 * position of each group's earliest version. Returns the groups in order.
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
  return [...byGroup.values()];
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
 * selected), ordered by each group's earliest version. Assistant messages
 * carry version metadata; single-version groups return exactly what the
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

export async function appendUserMessage(
  input: { topicId: string; message: ChatUIMessage },
  actor: Actor,
): Promise<ChatUIMessage> {
  await requireOwnedTopic(input.topicId, actor);
  const db = getDb();
  const id = input.message.id.length > 0 ? input.message.id : newId();
  // Attachments ride along in the persisted parts so the history keeps the
  // file references the UI renders; the model payload is routed separately at
  // send time (`resolveAttachmentsForModel`).
  const parts = input.message.parts.filter(
    (part) => part.type === "text" || part.type === "file",
  );
  const inserted = await db
    .insert(chatMessages)
    .values({
      id,
      topicId: input.topicId,
      role: "user",
      parts,
      // User messages are always single-version groups keyed by their own id.
      groupId: id,
    })
    .returning();
  const row = inserted[0];
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
    createdAt?: Date;
    /** Existing group to add a version to; omit for a new single-version group. */
    groupId?: string;
  },
  actor: Actor,
): Promise<ChatUIMessage> {
  await requireOwnedTopic(input.topicId, actor);
  const db = getDb();
  const id = input.message.id.length > 0 ? input.message.id : newId();
  const values = {
    id,
    topicId: input.topicId,
    role: "assistant" as const,
    parts: input.message.parts,
    outcome: input.outcome,
    errorMessage: input.errorMessage ?? null,
    providerConfigId: input.providerConfigId,
    modelId: input.modelId,
    // Undefined falls back to the column default (null / defaultNow());
    // createdAt is the stream-start time so a reloaded history shows the
    // same value the live stream announced.
    reasoningMs: input.reasoningMs,
    createdAt: input.createdAt,
    groupId: input.groupId ?? id,
  };
  const existingGroupId = input.groupId;
  const row = existingGroupId
    ? // New version of an existing group: deselect siblings and insert the
      // new selected version atomically (partial unique index on the group).
      await db.transaction(async (tx) => {
        await tx
          .update(chatMessages)
          .set({ isSelected: false })
          .where(
            and(
              eq(chatMessages.topicId, input.topicId),
              eq(chatMessages.groupId, existingGroupId),
            ),
          );
        const inserted = await tx.insert(chatMessages).values(values).returning();
        return inserted[0];
      })
    : (await db.insert(chatMessages).values(values).returning())[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "message.storeFailed");
  }
  return rowToChatUIMessage(row);
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

  if (target.role === "assistant") {
    return {
      targetGroupId: target.groupId,
      history: selectedView(targetGroupIndex),
    };
  }

  const nextGroup = groups[targetGroupIndex + 1];
  const nextSelected = nextGroup ? selectedRowOf(nextGroup) : undefined;
  if (nextGroup && nextSelected?.role === "assistant") {
    return {
      targetGroupId: nextSelected.groupId,
      history: selectedView(targetGroupIndex + 1),
    };
  }
  return {
    targetGroupId: null,
    history: selectedView(targetGroupIndex + 1),
  };
}
