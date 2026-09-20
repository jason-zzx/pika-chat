import "server-only";

import { generateText } from "ai";
import { and, eq, sql } from "drizzle-orm";

import { pairOrNull } from "@/lib/schemas/model-preferences";
import {
  translateLanguageNativeName,
  type TranslateTargetLanguageCode,
} from "@/lib/translate/languages";
import { createChatModelHandle } from "@/server/ai/chat-model";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { assistants, chatMessages, topics } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { uiPartsFromJson } from "@/server/services/message.service";
import { resolveModelPreference } from "@/server/services/model-preferences.service";

const TRANSLATE_TIMEOUT_MS = 60_000;

/**
 * One-shot translation prompt (PRD R1/R3): translation only, markdown
 * structure and code blocks preserved, same-language input returned as-is.
 * Private to this module — chat-turn instruction assembly stays with
 * `buildChatInstructions` (project rule #109), which this does not use.
 */
export function buildTranslateInstructions(
  targetLang: TranslateTargetLanguageCode,
): string {
  const target = translateLanguageNativeName(targetLang);
  return [
    `Translate the user's message into ${target}.`,
    "Output the translation only — no explanations, no notes, no surrounding quotes.",
    "Preserve the markdown structure; do not translate code blocks or inline code.",
    `If the message is already in ${target}, return it unchanged.`,
  ].join(" ");
}

/**
 * Translates one message version into `targetLang` with the caller's current
 * chat model and persists the result on the row's `translations` jsonb.
 * A cached translation for the same language is returned without calling the
 * model again (PRD R4).
 */
export async function translateMessage(
  input: {
    messageId: string;
    targetLang: TranslateTargetLanguageCode;
    providerConfigId?: string;
    modelId?: string;
  },
  actor: Actor,
): Promise<{ translation: string }> {
  const db = getDb();
  // Ownership isolation: the message resolves through its topic's assistant
  // to the owner in the WHERE clause, so a missing and a foreign message are
  // indistinguishable (database-guidelines / error-handling specs).
  const rows = await db
    .select({
      id: chatMessages.id,
      parts: chatMessages.parts,
      translations: chatMessages.translations,
    })
    .from(chatMessages)
    .innerJoin(topics, eq(chatMessages.topicId, topics.id))
    .innerJoin(assistants, eq(topics.assistantId, assistants.id))
    .where(
      and(
        eq(chatMessages.id, input.messageId),
        eq(assistants.ownerId, actor.userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "message.notFound");
  }

  const cached = row.translations?.[input.targetLang];
  if (cached !== undefined) {
    return { translation: cached };
  }

  const sourceText = uiPartsFromJson(row.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  if (sourceText.trim().length === 0) {
    throw new AppError("VALIDATION_FAILED", 400, "translation.emptyText");
  }

  // The user's translation-model preference wins unconditionally; the
  // client-supplied pair is the fallback, and with neither the request is a
  // 400 (unlike title generation there is no text-only fallback here).
  const pair =
    (await resolveModelPreference(actor, "translation")) ?? pairOrNull(input);
  if (!pair) {
    throw new AppError("VALIDATION_FAILED", 400, "model.notAvailable");
  }
  // Resolves the pair against the caller's own ∪ shared configs before any
  // credential is decrypted — the model-availability gate.
  const handle = await createChatModelHandle(pair, actor);
  let translation: string;
  try {
    const result = await generateText({
      model: handle.model,
      instructions: buildTranslateInstructions(input.targetLang),
      prompt: sourceText,
      abortSignal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    });
    translation = result.text.trim();
  } catch (error) {
    const description = handle.describeError(error);
    if (description.kind === "key") {
      throw new AppError(
        description.code,
        description.code === "RATE_LIMITED" ? 429 : 502,
        description.messageKey,
        description.params,
      );
    }
    // Verbatim upstream text cannot ride the error envelope (it has no
    // message field); the generic provider key is the boundary-safe copy.
    throw new AppError("PROVIDER_ERROR", 502, "provider.requestFailed");
  }
  if (translation.length === 0) {
    throw new AppError("PROVIDER_ERROR", 502, "provider.unexpectedResponse");
  }

  // Merge only the target-language key (jsonb `||` is per-key last-write),
  // so concurrent translations of other languages on the row survive.
  await db
    .update(chatMessages)
    .set({
      translations: sql`coalesce(${chatMessages.translations}, '{}'::jsonb) || ${JSON.stringify({ [input.targetLang]: translation })}::jsonb`,
    })
    .where(eq(chatMessages.id, row.id));

  return { translation };
}
