import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import {
  type RenameTopicInput,
  type SetTopicFavoriteInput,
  type Topic,
  type TopicDetail,
} from "@/lib/schemas/topic";
import { newTopicId } from "@/lib/id";
import type { Actor } from "@/server/auth/actor";
import { getDb, type DbTransaction } from "@/server/db/client";
import { assistants, chatMessages, topicColumns, topics } from "@/server/db/schema";
import { insertWithShortId } from "@/server/db/short-id-insert";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  deleteFilesIfUnreferenced,
  fileIdsFromParts,
} from "@/server/files/file.service";
import { requireOwnedAssistant } from "@/server/services/assistant.service";
import { markGenerationsForDeletedTopics } from "@/server/services/generation-target.service";

function ownedAssistantIds(actor: Actor) {
  const db = getDb();
  return db
    .select({ id: assistants.id })
    .from(assistants)
    .where(eq(assistants.ownerId, actor.userId));
}

/** `defaultTitle` is the request-locale `Chat.newTopic` sentinel; the route
 * boundary resolves it so this service stays transport-agnostic. */
export async function createTopicForChat(
  input: { assistantId: string },
  actor: Actor,
  defaultTitle: string,
): Promise<Topic> {
  const assistant = await requireOwnedAssistant(input.assistantId, actor);
  const db = getDb();
  const { result: inserted } = await insertWithShortId({
    mint: newTopicId,
    insert: (id) =>
      db
        .insert(topics)
        .values({
          id,
          assistantId: assistant.id,
          title: defaultTitle,
        })
        .returning(topicColumns),
  });
  const row = inserted[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "topic.createFailed");
  }
  logger.info(
    { userId: actor.userId, topicId: row.id, assistantId: assistant.id },
    "topic created",
  );
  return row;
}

export async function renameTopic(
  id: string,
  input: RenameTopicInput,
  actor: Actor,
): Promise<Topic> {
  const db = getDb();
  const updated = await db
    .update(topics)
    .set({ title: input.title, updatedAt: new Date() })
    .where(and(eq(topics.id, id), inArray(topics.assistantId, ownedAssistantIds(actor))))
    .returning(topicColumns);
  const row = updated[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  logger.info({ userId: actor.userId, topicId: id }, "topic renamed");
  return row;
}

/** Flips the favorite flag only. `updatedAt` is the last-active-time sort
 * key, so a favorite toggle must not touch it — otherwise favoriting an old
 * topic would silently jump it to the top of the list. */
export async function setTopicFavorite(
  id: string,
  input: SetTopicFavoriteInput,
  actor: Actor,
): Promise<Topic> {
  const db = getDb();
  const updated = await db
    .update(topics)
    .set({ isFavorite: input.favorite })
    .where(and(eq(topics.id, id), inArray(topics.assistantId, ownedAssistantIds(actor))))
    .returning(topicColumns);
  const row = updated[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  logger.info(
    { userId: actor.userId, topicId: id, favorite: input.favorite },
    "topic favorite toggled",
  );
  return row;
}

export async function deleteTopic(id: string, actor: Actor): Promise<void> {
  const db = getDb();
  const owned = and(
    eq(topics.id, id),
    inArray(topics.assistantId, ownedAssistantIds(actor)),
  );
  // Deleting a topic cancels its generation (chat task §8): the transaction
  // takes the parent row lock first, marks every generation of the topic as
  // target-deleted (active ones stop), and only then removes the rows, so a
  // concurrent finalize either loses the race (and discards its output) or
  // commits before the delete removes it. `deleteTopic` is the only writer of
  // this row, and the message cascade is the child side.
  let messageRows: { parts: unknown }[] = [];
  const deleted = await db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: topics.id })
      .from(topics)
      .where(owned)
      .for("update");
    if (locked.length === 0) {
      throw new AppError("NOT_FOUND", 404, "topic.notFound");
    }
    // Attachment references are read AFTER the lock, so a finalize that
    // committed its images just before this transaction is visible here and
    // its files are cleaned. A finalize that loses the lock writes nothing and
    // reclaims its own files (chat task §8 — no orphaned generated images).
    messageRows = await tx
      .select({ parts: chatMessages.parts })
      .from(chatMessages)
      .where(eq(chatMessages.topicId, id));
    await markGenerationsForDeletedTopics(tx, [id]);
    return tx.delete(topics).where(owned).returning({ id: topics.id });
  });
  if (!deleted[0]) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  // After the commit (the deletion is durable), drop the local producer's
  // content and subscriptions and abort it, so it neither keeps calling the
  // provider for a topic nobody can read nor hands late chunks to a client
  // that is still attached (chat task §8).
  const { discardGenerationsForTopic } = await import(
    "@/server/ai/generation-runner"
  );
  discardGenerationsForTopic(id);
  // References are gone now; drop whatever no other message still needs.
  await deleteFilesIfUnreferenced(
    messageRows.flatMap((row) => fileIdsFromParts(row.parts)),
    actor,
  );
  logger.info({ userId: actor.userId, topicId: id }, "topic deleted");
}

export async function findTopicForActor(
  id: string,
  actor: Actor,
): Promise<Topic | null> {
  const db = getDb();
  const rows = await db
    .select(topicColumns)
    .from(topics)
    .innerJoin(assistants, eq(assistants.id, topics.assistantId))
    .where(and(eq(topics.id, id), eq(assistants.ownerId, actor.userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** The shared projection plus the compression boundary. The summary columns
 * are deliberately not in `topicColumns` — only this detail read needs
 * them, so list endpoints keep their existing shape. */
export async function findTopicDetailForActor(
  id: string,
  actor: Actor,
): Promise<TopicDetail | null> {
  const db = getDb();
  const rows = await db
    .select({
      ...topicColumns,
      summaryUpToMessageId: topics.summaryUpToMessageId,
      // The boundary's version group (null when the row no longer resolves),
      // so the client marker and lock survive a version switch.
      summaryUpToGroupId: chatMessages.groupId,
      summaryText: topics.summaryText,
    })
    .from(topics)
    .innerJoin(assistants, eq(assistants.id, topics.assistantId))
    .leftJoin(chatMessages, eq(chatMessages.id, topics.summaryUpToMessageId))
    .where(and(eq(topics.id, id), eq(assistants.ownerId, actor.userId)))
    .limit(1);
  return rows[0] ?? null;
}

export type TopicContext = {
  topic: { id: string; title: string };
  assistant: {
    id: string;
    systemPrompt: string | null;
    defaultProviderConfigId: string | null;
    defaultModelId: string | null;
  };
};

export async function findTopicContextForActor(
  id: string,
  actor: Actor,
  options?: { tx?: DbTransaction },
): Promise<TopicContext | null> {
  const db = options?.tx ?? getDb();
  const rows = await db
    .select({
      topicId: topics.id,
      topicTitle: topics.title,
      assistantId: assistants.id,
      systemPrompt: assistants.systemPrompt,
      defaultProviderConfigId: assistants.defaultProviderConfigId,
      defaultModelId: assistants.defaultModelId,
    })
    .from(topics)
    .innerJoin(assistants, eq(assistants.id, topics.assistantId))
    .where(and(eq(topics.id, id), eq(assistants.ownerId, actor.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    topic: { id: row.topicId, title: row.topicTitle },
    assistant: {
      id: row.assistantId,
      systemPrompt: row.systemPrompt,
      defaultProviderConfigId: row.defaultProviderConfigId,
      defaultModelId: row.defaultModelId,
    },
  };
}

export async function touchTopicUpdatedAt(
  topicId: string,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  await db
    .update(topics)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(topics.id, topicId),
        inArray(topics.assistantId, ownedAssistantIds(actor)),
      ),
    );
}
