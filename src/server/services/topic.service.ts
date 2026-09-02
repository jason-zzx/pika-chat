import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { DEFAULT_TOPIC_TITLE, type RenameTopicInput, type Topic } from "@/lib/schemas/topic";
import { newId } from "@/lib/id";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { assistants, topics } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { requireOwnedAssistant } from "@/server/services/assistant.service";

function ownedAssistantIds(actor: Actor) {
  const db = getDb();
  return db
    .select({ id: assistants.id })
    .from(assistants)
    .where(eq(assistants.ownerId, actor.userId));
}

export async function createTopicForChat(
  input: { assistantId: string },
  actor: Actor,
): Promise<Topic> {
  const assistant = await requireOwnedAssistant(input.assistantId, actor);
  const db = getDb();
  const inserted = await db
    .insert(topics)
    .values({
      id: newId(),
      assistantId: assistant.id,
      title: DEFAULT_TOPIC_TITLE,
    })
    .returning({
      id: topics.id,
      title: topics.title,
      createdAt: topics.createdAt,
      updatedAt: topics.updatedAt,
    });
  const row = inserted[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "Failed to create topic");
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
    .returning({
      id: topics.id,
      title: topics.title,
      createdAt: topics.createdAt,
      updatedAt: topics.updatedAt,
    });
  const row = updated[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "Topic not found");
  }
  logger.info({ userId: actor.userId, topicId: id }, "topic renamed");
  return row;
}

export async function deleteTopic(id: string, actor: Actor): Promise<void> {
  const db = getDb();
  const deleted = await db
    .delete(topics)
    .where(and(eq(topics.id, id), inArray(topics.assistantId, ownedAssistantIds(actor))))
    .returning({ id: topics.id });
  if (!deleted[0]) {
    throw new AppError("NOT_FOUND", 404, "Topic not found");
  }
  logger.info({ userId: actor.userId, topicId: id }, "topic deleted");
}

export async function findTopicForActor(
  id: string,
  actor: Actor,
): Promise<Topic | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      createdAt: topics.createdAt,
      updatedAt: topics.updatedAt,
    })
    .from(topics)
    .innerJoin(assistants, eq(assistants.id, topics.assistantId))
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
): Promise<TopicContext | null> {
  const db = getDb();
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
