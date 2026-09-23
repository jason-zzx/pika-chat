import "server-only";

import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";

import type { ProviderApiFormat } from "@/lib/provider-format";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import { describeProviderError } from "@/server/ai/provider-error";
import {
  createFilesApi,
  createLanguageModel,
  type FilesApiProvider,
  type ProviderEndpoint,
} from "@/server/ai/provider-factory";
import type { Actor } from "@/server/auth/actor";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { providerConfigs } from "@/server/db/schema";
import { AppError } from "@/server/errors";

export type ChatModelHandle = {
  model: LanguageModel;
  describeError: (error: unknown) => ReturnType<typeof describeProviderError>;
  /** Endpoint format of the config the model was built from. */
  apiFormat: ProviderApiFormat;
  /** Config the model belongs to — attachments namespace references by it. */
  providerConfigId: string;
  /**
   * Provider instance exposing the Files API, or `null` for formats without
   * one. `null` here is what keeps `openai-compatible` on the inline path.
   */
  filesApi: FilesApiProvider | null;
  /**
   * Endpoint the model was built from. The image-generation bypass speaks
   * to it directly (no chat `model` is involved), so it rides the handle.
   */
  endpoint: ProviderEndpoint;
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
 * Loads a provider config by id into the endpoint shape the provider factory
 * and the Files API transport consume. Returns `null` when the config no
 * longer exists — callers that act on a stored provider reference treat that
 * as an abandoned reference rather than an error.
 */
export async function loadProviderEndpoint(
  providerConfigId: string,
): Promise<ProviderEndpoint | null> {
  const config = await loadConfigRow(providerConfigId);
  if (!config) {
    return null;
  }
  return {
    apiFormat: config.apiFormat,
    name: config.name,
    baseUrl: config.baseUrl,
    apiKey: config.encryptedApiKey
      ? decryptSecret(config.encryptedApiKey)
      : "",
  };
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

  const endpoint = await loadProviderEndpoint(pair.providerConfigId);
  if (!endpoint) {
    throw new AppError(
      "VALIDATION_FAILED",
      400,
      "model.notAvailable",
    );
  }

  const model = createLanguageModel(endpoint, pair.modelId, options);
  return {
    model,
    describeError: (error: unknown) =>
      describeProviderError(error, {
        apiKey: endpoint.apiKey,
        baseUrl: endpoint.baseUrl,
      }),
    apiFormat: endpoint.apiFormat,
    providerConfigId: pair.providerConfigId,
    filesApi: createFilesApi(endpoint),
    endpoint,
  };
}
