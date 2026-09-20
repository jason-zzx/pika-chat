import "server-only";

import { generateText } from "ai";
import { and, eq, inArray } from "drizzle-orm";

import { DEFAULT_TOPIC_TITLES, isDefaultTopicTitle } from "@/i18n/defaults";
import { pairOrNull } from "@/lib/schemas/model-preferences";
import type { Topic } from "@/lib/schemas/topic";
import { createChatModelHandle } from "@/server/ai/chat-model";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { assistants, topicColumns, topics } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  listTopicMessages,
  textFromMessage,
} from "@/server/services/message.service";
import { resolveModelPreference } from "@/server/services/model-preferences.service";
import { findTopicForActor } from "@/server/services/topic.service";

export const TITLE_MAX_LENGTH = 60;
const GENERATED_TOO_LONG = 200;

export function sanitizeGeneratedTitle(raw: string): string | null {
  let text = raw.trim();
  text = text.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "").trim();
  text = text.replace(/\s+/g, " ");
  if (text.length === 0 || text.length > GENERATED_TOO_LONG) {
    return null;
  }
  if (text.length > TITLE_MAX_LENGTH) {
    return text.slice(0, TITLE_MAX_LENGTH).trimEnd();
  }
  return text;
}

/** `defaultTitle` is the sentinel already stored on the topic (its creator's
 * locale) — empty first-message text must leave that placeholder in place. */
export function fallbackTitleFromMessage(
  text: string,
  defaultTitle: string,
): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) {
    return defaultTitle;
  }
  if (collapsed.length <= TITLE_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}

export async function titleTopicFromFirstMessage(
  input: {
    topicId: string;
    providerConfigId?: string;
    modelId?: string;
  },
  actor: Actor,
): Promise<Topic> {
  const topic = await findTopicForActor(input.topicId, actor);
  if (!topic) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  if (!isDefaultTopicTitle(topic.title)) {
    return topic;
  }

  const messages = await listTopicMessages(
    { topicId: input.topicId },
    actor,
  );
  const firstUser = messages.find((message) => message.role === "user");
  const text = firstUser ? textFromMessage(firstUser) : "";

  let generated: string | null = null;
  if (text.trim().length > 0) {
    // The user's title-model preference wins unconditionally; the
    // client-supplied pair (the first message's model) is the fallback, and
    // with neither the topic just gets the truncated-text title.
    const pair =
      (await resolveModelPreference(actor, "title")) ?? pairOrNull(input);
    if (pair) {
      try {
        const handle = await createChatModelHandle(pair, actor);
        const result = await generateText({
          model: handle.model,
          instructions:
            "Write a short conversation title from the user's message. Reply with the title only, no quotes, at most 8 words.",
          prompt: text,
          maxOutputTokens: 40,
          abortSignal: AbortSignal.timeout(15_000),
        });
        generated = sanitizeGeneratedTitle(result.text);
      } catch {
        logger.warn(
          { topicId: input.topicId },
          "topic title generation failed",
        );
      }
    }
  }

  const title = generated ?? fallbackTitleFromMessage(text, topic.title);
  try {
    const db = getDb();
    const updated = await db
      .update(topics)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(topics.id, input.topicId),
          inArray(topics.title, DEFAULT_TOPIC_TITLES),
          inArray(
            topics.assistantId,
            db
              .select({ id: assistants.id })
              .from(assistants)
              .where(eq(assistants.ownerId, actor.userId)),
          ),
        ),
      )
      .returning(topicColumns);
    const row = updated[0];
    if (row) {
      return row;
    }
  } catch {
    logger.warn({ topicId: input.topicId }, "topic title write failed");
  }

  const current = await findTopicForActor(input.topicId, actor);
  if (!current) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  return current;
}
