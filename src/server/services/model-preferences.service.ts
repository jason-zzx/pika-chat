import "server-only";

import { eq } from "drizzle-orm";

import {
  parseModelPreferences,
  type ModelPair,
  type ModelPreferencePurpose,
  type ModelPreferences,
} from "@/lib/schemas/model-preferences";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AppError } from "@/server/errors";

const PURPOSES: ModelPreferencePurpose[] = [
  "chat",
  "title",
  "compression",
  "translation",
];

function pairIsAvailable(
  available: readonly { configId: string; modelId: string }[],
  pair: ModelPair,
): boolean {
  return available.some(
    (model) =>
      model.configId === pair.providerConfigId && model.modelId === pair.modelId,
  );
}

/** Reads one user's model preferences; dirty jsonb degrades to empty prefs. */
export async function getModelPreferences(
  userId: string,
): Promise<ModelPreferences> {
  const row = (
    await getDb()
      .select({ modelPreferences: users.modelPreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  return parseModelPreferences(row.modelPreferences);
}

/**
 * Self-service replacement of all four slots. Every set pair is validated
 * against the caller's available models; an unusable pair fails the whole
 * write with `model.notAvailable` (availability is enforced only here — a
 * preference that later goes stale silently falls back at use time).
 */
export async function updateModelPreferences(
  input: ModelPreferences,
  actor: Actor,
): Promise<ModelPreferences> {
  const available = await resolveAvailableModels(actor);
  for (const purpose of PURPOSES) {
    const pair = input[purpose];
    if (pair && !pairIsAvailable(available, pair)) {
      throw new AppError("VALIDATION_FAILED", 400, "model.notAvailable");
    }
  }
  const updated = await getDb()
    .update(users)
    .set({ modelPreferences: input, updatedAt: new Date() })
    .where(eq(users.id, actor.userId))
    .returning({ id: users.id });
  if (!updated[0]) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  return input;
}

/**
 * Resolves one preference slot to a still-usable pair. Unset or stale
 * (provider/model deleted) resolves to null so callers take their existing
 * fallback path — never throws.
 */
export async function resolveModelPreference(
  actor: Actor,
  purpose: ModelPreferencePurpose,
): Promise<ModelPair | null> {
  const preferences = await getModelPreferences(actor.userId);
  const pair = preferences[purpose];
  if (!pair) {
    return null;
  }
  const available = await resolveAvailableModels(actor);
  return pairIsAvailable(available, pair) ? pair : null;
}
