import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  DEFAULT_ASSISTANT_ICON,
  type Assistant,
  type AssistantTree,
  type CreateAssistantInput,
  type UpdateAssistantInput,
} from "@/lib/schemas/assistant";
import { newAssistantId } from "@/lib/id";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { assistants, topics } from "@/server/db/schema";
import { insertWithShortId } from "@/server/db/short-id-insert";
import { isUniqueViolation } from "@/server/db/unique-violation";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  deleteFilesIfUnreferenced,
  fileIdsForTopics,
} from "@/server/files/file.service";
import { markGenerationsForDeletedTopics } from "@/server/services/generation-target.service";

type AssistantRow = typeof assistants.$inferSelect;

function conflictOnName(): never {
  throw new AppError(
    "CONFLICT",
    409,
    "assistant.nameTaken",
  );
}

async function selectTree(actor: Actor, assistantId?: string): Promise<Assistant[]> {
  const db = getDb();
  return db
    .select({
      id: assistants.id,
      name: assistants.name,
      icon: assistants.icon,
      systemPrompt: assistants.systemPrompt,
      defaultProviderConfigId: assistants.defaultProviderConfigId,
      defaultModelId: assistants.defaultModelId,
      topicCount: sql<number>`count(${topics.id})`,
    })
    .from(assistants)
    .leftJoin(topics, eq(topics.assistantId, assistants.id))
    .where(
      assistantId
        ? and(
            eq(assistants.ownerId, actor.userId),
            eq(assistants.id, assistantId),
          )
        : eq(assistants.ownerId, actor.userId),
    )
    .groupBy(assistants.id)
    .orderBy(asc(assistants.createdAt));
}

async function loadAssistant(id: string, actor: Actor): Promise<Assistant> {
  const assistant = (await selectTree(actor, id))[0];
  if (!assistant) {
    throw new AppError("NOT_FOUND", 404, "assistant.notFound");
  }
  return assistant;
}

function modelPairFromInput(input: {
  defaultProviderConfigId?: string | null;
  defaultModelId?: string | null;
}): { defaultProviderConfigId: string | null; defaultModelId: string | null } | undefined {
  if (
    input.defaultProviderConfigId === undefined &&
    input.defaultModelId === undefined
  ) {
    return undefined;
  }
  const configId = input.defaultProviderConfigId ?? null;
  const modelId = input.defaultModelId ?? null;
  if (!configId || !modelId) {
    return { defaultProviderConfigId: null, defaultModelId: null };
  }
  return { defaultProviderConfigId: configId, defaultModelId: modelId };
}

async function assertModelAvailable(
  pair: { defaultProviderConfigId: string | null; defaultModelId: string | null },
  actor: Actor,
): Promise<void> {
  if (!pair.defaultProviderConfigId || !pair.defaultModelId) {
    return;
  }
  const available = await resolveAvailableModels(actor);
  const ok = available.some(
    (model) =>
      model.configId === pair.defaultProviderConfigId &&
      model.modelId === pair.defaultModelId,
  );
  if (!ok) {
    throw new AppError(
      "VALIDATION_FAILED",
      400,
      "model.notAvailable",
    );
  }
}

export async function requireOwnedAssistant(
  id: string,
  actor: Actor,
): Promise<AssistantRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(assistants)
    .where(and(eq(assistants.id, id), eq(assistants.ownerId, actor.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "assistant.notFound");
  }
  return row;
}

/** `defaultName` is the request-locale `Assistant.defaultName`; the route
 * boundary resolves it so this service stays transport-agnostic. */
export async function listAssistantTree(
  actor: Actor,
  defaultName: string,
): Promise<AssistantTree> {
  const existing = await selectTree(actor);
  if (existing.length > 0) {
    return { assistants: existing };
  }

  const db = getDb();
  insertWithShortId({
    mint: newAssistantId,
    insert: (id) =>
      db
        .insert(assistants)
        .values({
          id,
          ownerId: actor.userId,
          name: defaultName,
          icon: DEFAULT_ASSISTANT_ICON,
        })
        .onConflictDoNothing({
          target: [assistants.ownerId, assistants.name],
        })
        .run(),
  });

  return { assistants: await selectTree(actor) };
}

export async function createAssistant(
  input: CreateAssistantInput,
  actor: Actor,
): Promise<Assistant> {
  const pair = modelPairFromInput(input) ?? {
    defaultProviderConfigId: null,
    defaultModelId: null,
  };
  await assertModelAvailable(pair, actor);

  const db = getDb();
  let createdId: string;
  try {
    ({ id: createdId } = insertWithShortId({
      mint: newAssistantId,
      insert: (id) =>
        db
          .insert(assistants)
          .values({
            id,
            ownerId: actor.userId,
            name: input.name,
            icon: input.icon,
            systemPrompt: input.systemPrompt ?? null,
            defaultProviderConfigId: pair.defaultProviderConfigId,
            defaultModelId: pair.defaultModelId,
          })
          .run(),
    }));
  } catch (error) {
    if (isUniqueViolation(error)) {
      conflictOnName();
    }
    throw error;
  }

  logger.info(
    { userId: actor.userId, assistantId: createdId },
    "assistant created",
  );
  return loadAssistant(createdId, actor);
}

export async function updateAssistant(
  id: string,
  input: UpdateAssistantInput,
  actor: Actor,
): Promise<Assistant> {
  await requireOwnedAssistant(id, actor);
  const pair = modelPairFromInput(input);
  if (pair) {
    await assertModelAvailable(pair, actor);
  }

  const db = getDb();
  const patch: {
    name?: string;
    icon?: string;
    systemPrompt?: string | null;
    defaultProviderConfigId?: string | null;
    defaultModelId?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.icon !== undefined) {
    patch.icon = input.icon;
  }
  if (input.systemPrompt !== undefined) {
    patch.systemPrompt = input.systemPrompt;
  }
  if (pair) {
    patch.defaultProviderConfigId = pair.defaultProviderConfigId;
    patch.defaultModelId = pair.defaultModelId;
  }

  try {
    const updated = await db
      .update(assistants)
      .set(patch)
      .where(and(eq(assistants.id, id), eq(assistants.ownerId, actor.userId)))
      .returning({ id: assistants.id });
    if (!updated[0]) {
      throw new AppError("NOT_FOUND", 404, "assistant.notFound");
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      conflictOnName();
    }
    throw error;
  }

  logger.info({ userId: actor.userId, assistantId: id }, "assistant updated");
  return loadAssistant(id, actor);
}

export async function deleteAssistant(id: string, actor: Actor): Promise<void> {
  const db = getDb();
  const { deletedTopicIds, releasedFileIds } = db.transaction(
    (tx) => {
      const owned = tx
        .select({ id: assistants.id })
        .from(assistants)
        .where(eq(assistants.ownerId, actor.userId))
        .all();

      if (!owned.some((row) => row.id === id)) {
        throw new AppError("NOT_FOUND", 404, "assistant.notFound");
      }
      if (owned.length <= 1) {
        throw new AppError(
          "CONFLICT",
          409,
          "assistant.lastOne",
        );
      }

      // Deleting an assistant deletes its topics (cascade), which must cancel
      // their generations in the same transaction (chat task §8): mark them
      // target-deleted, then let the cascade remove the rows.
      const topicIds = tx
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.assistantId, id))
        .all()
        .map((row) => row.id);
      const fileIds = fileIdsForTopics(tx, topicIds);
      markGenerationsForDeletedTopics(tx, topicIds);
      tx.delete(assistants)
        .where(
          and(eq(assistants.id, id), eq(assistants.ownerId, actor.userId)),
        )
        .run();
      return { deletedTopicIds: topicIds, releasedFileIds: fileIds };
    },
    { behavior: "immediate" },
  );
  const { discardGenerationsForTopic } = await import(
    "@/server/ai/generation-runner"
  );
  for (const topicId of deletedTopicIds) {
    discardGenerationsForTopic(topicId);
  }
  await deleteFilesIfUnreferenced(releasedFileIds, actor);
  logger.info({ userId: actor.userId, assistantId: id }, "assistant deleted");
}
