import "server-only";

import { generateText, type LanguageModel } from "ai";
import { and, eq, inArray } from "drizzle-orm";

import { DEFAULT_TOPIC_TITLE } from "@/lib/schemas/topic";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { assistants, topics } from "@/server/db/schema";
import { logger } from "@/server/logger";

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

export function fallbackTitleFromMessage(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) {
    return DEFAULT_TOPIC_TITLE;
  }
  if (collapsed.length <= TITLE_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}

export async function titleTopicFromFirstMessage(args: {
  topicId: string;
  text: string;
  model: LanguageModel;
  actor: Actor;
}): Promise<void> {
  let generated: string | null = null;
  try {
    const result = await generateText({
      model: args.model,
      instructions:
        "Write a short conversation title from the user's message. Reply with the title only, no quotes, at most 8 words.",
      prompt: args.text,
      maxOutputTokens: 40,
      abortSignal: AbortSignal.timeout(15_000),
    });
    generated = sanitizeGeneratedTitle(result.text);
  } catch {
    logger.warn(
      { topicId: args.topicId },
      "topic title generation failed",
    );
  }

  const title = generated ?? fallbackTitleFromMessage(args.text);
  try {
    const db = getDb();
    await db
      .update(topics)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(topics.id, args.topicId),
          eq(topics.title, DEFAULT_TOPIC_TITLE),
          inArray(
            topics.assistantId,
            db
              .select({ id: assistants.id })
              .from(assistants)
              .where(eq(assistants.ownerId, args.actor.userId)),
          ),
        ),
      );
  } catch {
    logger.warn({ topicId: args.topicId }, "topic title write failed");
  }
}
