import "server-only";

import { asc, eq } from "drizzle-orm";

import { newId } from "@/lib/id";
import {
  chatStoredPartSchema,
  type ChatMessageOutcome,
  type ChatMetadata,
  type ChatUIMessage,
} from "@/lib/schemas/chat";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { chatMessages } from "@/server/db/schema";
import { AppError } from "@/server/errors";
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

export function metadataFromRow(row: {
  role: ChatMessageRow["role"];
  outcome: ChatMessageRow["outcome"];
  errorMessage: ChatMessageRow["errorMessage"];
  providerConfigId: ChatMessageRow["providerConfigId"];
  modelId: ChatMessageRow["modelId"];
  reasoningMs: ChatMessageRow["reasoningMs"];
  createdAt: ChatMessageRow["createdAt"];
}): ChatMetadata | undefined {
  if (row.role !== "assistant") {
    return { createdAt: row.createdAt.toISOString() };
  }
  return {
    outcome: row.outcome ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    providerConfigId: row.providerConfigId ?? undefined,
    modelId: row.modelId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    reasoningMs: row.reasoningMs ?? undefined,
  };
}

export function rowToChatUIMessage(row: ChatMessageRow): ChatUIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: uiPartsFromJson(row.parts),
    metadata: metadataFromRow(row),
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
    throw new AppError("NOT_FOUND", 404, "Topic not found");
  }
}

export async function listTopicMessages(
  input: { topicId: string },
  actor: Actor,
): Promise<ChatUIMessage[]> {
  await requireOwnedTopic(input.topicId, actor);
  const db = getDb();
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.topicId, input.topicId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return rows.map(rowToChatUIMessage);
}

export async function appendUserMessage(
  input: { topicId: string; message: ChatUIMessage },
  actor: Actor,
): Promise<ChatUIMessage> {
  await requireOwnedTopic(input.topicId, actor);
  const db = getDb();
  const id = input.message.id.length > 0 ? input.message.id : newId();
  const parts = input.message.parts.filter((part) => part.type === "text");
  const inserted = await db
    .insert(chatMessages)
    .values({
      id,
      topicId: input.topicId,
      role: "user",
      parts,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "Failed to store message");
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
  },
  actor: Actor,
): Promise<ChatUIMessage> {
  await requireOwnedTopic(input.topicId, actor);
  const db = getDb();
  const id = input.message.id.length > 0 ? input.message.id : newId();
  const inserted = await db
    .insert(chatMessages)
    .values({
      id,
      topicId: input.topicId,
      role: "assistant",
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
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new AppError("INTERNAL", 500, "Failed to store message");
  }
  return rowToChatUIMessage(row);
}
