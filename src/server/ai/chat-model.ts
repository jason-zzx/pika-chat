import "server-only";

import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";

import { resolveAvailableModels } from "@/server/ai/model-resolution";
import { describeProviderError } from "@/server/ai/provider-error";
import { createLanguageModel } from "@/server/ai/provider-factory";
import type { Actor } from "@/server/auth/actor";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { providerConfigs } from "@/server/db/schema";
import { AppError } from "@/server/errors";

export type ChatModelHandle = {
  model: LanguageModel;
  describeError: (error: unknown) => ReturnType<typeof describeProviderError>;
};

async function loadConfigRow(providerConfigId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: providerConfigs.id,
      name: providerConfigs.name,
      baseUrl: providerConfigs.baseUrl,
      apiFormat: providerConfigs.apiFormat,
      encryptedApiKey: providerConfigs.encryptedApiKey,
    })
    .from(providerConfigs)
    .where(eq(providerConfigs.id, providerConfigId))
    .limit(1);
  return rows[0];
}

/**
 * Resolves the pair against the caller's own ∪ shared configs before decrypting
 * anything — `loadConfigRow` reads by id alone, so this is the ownership gate.
 */
export async function createChatModelHandle(
  pair: { providerConfigId: string; modelId: string },
  actor: Actor,
  options?: { builtinSearch?: boolean },
): Promise<ChatModelHandle> {
  const available = await resolveAvailableModels(actor);
  const allowed = available.some(
    (model) =>
      model.configId === pair.providerConfigId && model.modelId === pair.modelId,
  );
  if (!allowed) {
    throw new AppError(
      "VALIDATION_FAILED",
      400,
      "model.notAvailable",
    );
  }

  const config = await loadConfigRow(pair.providerConfigId);
  if (!config) {
    throw new AppError(
      "VALIDATION_FAILED",
      400,
      "model.notAvailable",
    );
  }

  const apiKey = config.encryptedApiKey
    ? decryptSecret(config.encryptedApiKey)
    : "";
  const model = createLanguageModel(
    {
      apiFormat: config.apiFormat,
      name: config.name,
      baseUrl: config.baseUrl,
      apiKey,
    },
    pair.modelId,
    options,
  );
  return {
    model,
    describeError: (error: unknown) => describeProviderError(error, apiKey),
  };
}
