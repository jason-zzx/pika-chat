import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

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
  fileIdsForTopics,
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
  const { result: row } = insertWithShortId({
    mint: newTopicId,
    insert: (id) =>
      db
        .insert(topics)
        .values({
          id,
          assistantId: assistant.id,
          title: defaultTitle,
        })
        .returning(topicColumns)
        .get(),
  });
  logger.info(
    { userId: actor.userId, topicId: row.id, assistantId: assistant.id },
    "topic created",
  );
  return row;
}

const TOPIC_PAGE_SIZE = 20;

/** `cursor` is `[updatedAtMs, id]` of the last row of the previous page.
 * SQLite stores timestamps in milliseconds, so epoch ms is exact; ties break
 * by `id`. */
export async function listTopicPage(
  assistantId: string,
  cursor: [number, string] | null,
  actor: Actor,
): Promise<{ topics: Topic[]; nextCursor: [number, string] | null }> {
  await requireOwnedAssistant(assistantId, actor);
  const rows = await getDb()
    .select(topicColumns)
    .from(topics)
    .where(
      and(
        eq(topics.assistantId, assistantId),
        eq(topics.isFavorite, false),
        cursor
          ? sql`(${topics.updatedAt}, ${topics.id}) < (${cursor[0]}, ${cursor[1]})`
          : undefined,
      ),
    )
    .orderBy(desc(topics.updatedAt), desc(topics.id))
    .limit(TOPIC_PAGE_SIZE + 1);
  const page = rows.slice(0, TOPIC_PAGE_SIZE);
  const last = rows.length > TOPIC_PAGE_SIZE ? page[page.length - 1] : undefined;
  return {
    topics: page,
    nextCursor: last ? [last.updatedAt.getTime(), last.id] : null,
  };
}

export async function listFavoriteTopics(
  assistantId: string,
  actor: Actor,
): Promise<Topic[]> {
  await requireOwnedAssistant(assistantId, actor);
  return getDb()
    .select(topicColumns)
    .from(topics)
    .where(and(eq(topics.assistantId, assistantId), eq(topics.isFavorite, true)))
    .orderBy(desc(topics.updatedAt), desc(topics.id));
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
  // Deleting a topic cancels its generation (chat task §8): one immediate
  // write transaction marks every generation of the topic as target-deleted
  // (active ones stop) and removes the rows. Write transactions serialize, so
  // a concurrent finalize either commits before this one (its files are seen
  // below) or finds the topic gone and discards its output.
  const releasedFileIds = db.transaction(
    (tx) => {
      const owner = tx
        .select({ id: topics.id })
        .from(topics)
        .where(owned)
        .get();
      if (!owner) {
        throw new AppError("NOT_FOUND", 404, "topic.notFound");
      }
      const fileIds = fileIdsForTopics(tx, [id]);
      markGenerationsForDeletedTopics(tx, [id]);
      tx.delete(topics).where(owned).run();
      return fileIds;
    },
    { behavior: "immediate" },
  );
  // After the commit (the deletion is durable), drop the local producer's
  // content and subscriptions and abort it, so it neither keeps calling the
  // provider for a topic nobody can read nor hands late chunks to a client
  // that is still attached (chat task §8).
  const { discardGenerationsForTopic } = await import(
    "@/server/ai/generation-runner"
  );
  discardGenerationsForTopic(id);
  // References are gone now; drop whatever no other message still needs.
  await deleteFilesIfUnreferenced(releasedFileIds, actor);
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
      assistantId: topics.assistantId,
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

export function findTopicContextForActor(
  id: string,
  actor: Actor,
  options?: { tx?: DbTransaction },
): TopicContext | null {
  const db = options?.tx ?? getDb();
  const row = db
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
    .limit(1)
    .get();
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
