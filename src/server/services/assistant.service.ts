import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import {
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_NAME,
  type Assistant,
  type AssistantTree,
  type CreateAssistantInput,
  type UpdateAssistantInput,
} from "@/lib/schemas/assistant";
import { newId } from "@/lib/id";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { assistants, topics } from "@/server/db/schema";
import { isUniqueViolation } from "@/server/db/unique-violation";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

type AssistantRow = typeof assistants.$inferSelect;

type TreeRow = {
  assistant: {
    id: string;
    name: string;
    icon: string;
    systemPrompt: string | null;
    defaultProviderConfigId: string | null;
    defaultModelId: string | null;
    createdAt: Date;
  };
  topic: {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

function conflictOnName(): never {
  throw new AppError(
    "CONFLICT",
    409,
    "An assistant with this name already exists",
  );
}

function toAssistant(
  row: TreeRow["assistant"],
  assistantTopics: NonNullable<TreeRow["topic"]>[],
): Assistant {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    systemPrompt: row.systemPrompt,
    defaultProviderConfigId: row.defaultProviderConfigId,
    defaultModelId: row.defaultModelId,
    topics: assistantTopics,
  };
}

function groupTree(rows: TreeRow[]): Assistant[] {
  const grouped = new Map<
    string,
    {
      assistant: TreeRow["assistant"];
      topics: NonNullable<TreeRow["topic"]>[];
    }
  >();
  for (const row of rows) {
    let entry = grouped.get(row.assistant.id);
    if (!entry) {
      entry = { assistant: row.assistant, topics: [] };
      grouped.set(row.assistant.id, entry);
    }
    if (row.topic?.id) {
      entry.topics.push(row.topic);
    }
  }
  return [...grouped.values()].map((entry) =>
    toAssistant(entry.assistant, entry.topics),
  );
}

async function selectTree(actor: Actor, assistantId?: string): Promise<TreeRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      assistant: {
        id: assistants.id,
        name: assistants.name,
        icon: assistants.icon,
        systemPrompt: assistants.systemPrompt,
        defaultProviderConfigId: assistants.defaultProviderConfigId,
        defaultModelId: assistants.defaultModelId,
        createdAt: assistants.createdAt,
      },
      topic: {
        id: topics.id,
        title: topics.title,
        createdAt: topics.createdAt,
        updatedAt: topics.updatedAt,
      },
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
    .orderBy(asc(assistants.createdAt), desc(topics.updatedAt));
  return rows;
}

async function loadAssistant(id: string, actor: Actor): Promise<Assistant> {
  const grouped = groupTree(await selectTree(actor, id));
  const assistant = grouped[0];
  if (!assistant) {
    throw new AppError("NOT_FOUND", 404, "Assistant not found");
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
      "Selected model is not available",
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
    throw new AppError("NOT_FOUND", 404, "Assistant not found");
  }
  return row;
}

export async function listAssistantTree(actor: Actor): Promise<AssistantTree> {
  const existing = await selectTree(actor);
  if (existing.length > 0) {
    return { assistants: groupTree(existing) };
  }

  const db = getDb();
  await db
    .insert(assistants)
    .values({
      id: newId(),
      ownerId: actor.userId,
      name: DEFAULT_ASSISTANT_NAME,
      icon: DEFAULT_ASSISTANT_ICON,
    })
    .onConflictDoNothing({
      target: [assistants.ownerId, assistants.name],
    });

  return { assistants: groupTree(await selectTree(actor)) };
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

  const id = newId();
  const db = getDb();
  try {
    const inserted = await db
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
      .returning({ id: assistants.id });
    if (!inserted[0]) {
      throw new AppError("INTERNAL", 500, "Failed to create assistant");
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      conflictOnName();
    }
    throw error;
  }

  logger.info({ userId: actor.userId, assistantId: id }, "assistant created");
  return loadAssistant(id, actor);
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
      throw new AppError("NOT_FOUND", 404, "Assistant not found");
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
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: assistants.id })
      .from(assistants)
      .where(eq(assistants.ownerId, actor.userId))
      .orderBy(asc(assistants.id))
      .for("update");

    if (!owned.some((row) => row.id === id)) {
      throw new AppError("NOT_FOUND", 404, "Assistant not found");
    }
    if (owned.length <= 1) {
      throw new AppError(
        "CONFLICT",
        409,
        "Cannot delete your only assistant",
      );
    }

    await tx
      .delete(assistants)
      .where(
        and(eq(assistants.id, id), eq(assistants.ownerId, actor.userId)),
      );
  });
  logger.info({ userId: actor.userId, assistantId: id }, "assistant deleted");
}
