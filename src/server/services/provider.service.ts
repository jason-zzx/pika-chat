import "server-only";

import { and, eq, or } from "drizzle-orm";

import { isStaffRole } from "@/lib/auth-hierarchy";
import { newId } from "@/lib/id";
import {
  requiresApiKey,
  type ProviderApiFormat,
} from "@/lib/provider-format";
import type {
  AddProviderModelInput,
  CreateProviderConfigInput,
  ModelMetadataFields,
  OwnProviderConfig,
  ProviderConfigList,
  ProviderModel,
  SharedProviderConfig,
  UpdateProviderConfigInput,
  UpdateProviderModelInput,
} from "@/lib/schemas/provider";
import { SEEDED_REASONING_OPTIONS } from "@/lib/schemas/provider";
import { fetchServedModelIds } from "@/server/ai/discovery";
import { fillMetadataForModelId } from "@/server/ai/model-catalog";
import {
  fillValues,
  hydrateUnsourcedModels,
  providerModelColumns,
  toProviderModel,
  type StoredProviderModel,
} from "@/server/ai/model-fill";
import type { Actor } from "@/server/auth/actor";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import {
  providerConfigs,
  providerModels,
  users,
} from "@/server/db/schema";
import { isUniqueViolation } from "@/server/db/unique-violation";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

type ConfigRow = typeof providerConfigs.$inferSelect;

function coerceVisibility(
  requested: "private" | "shared" | undefined,
  actor: Actor,
  fallback: "private" | "shared",
): "private" | "shared" {
  if (!isStaffRole(actor.role)) {
    return "private";
  }
  return requested ?? fallback;
}

function lastFour(value: string): string {
  return value.slice(-4);
}

/**
 * Formats that reject keyless calls must end up with a key, from either the
 * incoming payload or the stored row. Enforced here rather than in Zod because
 * update has to consult the existing row to answer it — Zod only sees the
 * payload. A rejected write must not touch the database.
 */
function assertApiKeyAvailable(
  format: ProviderApiFormat,
  hasKey: boolean,
): void {
  if (requiresApiKey(format) && !hasKey) {
    throw new AppError("VALIDATION_FAILED", 400, "provider.apiKeyRequired");
  }
}

function toOwnConfig(
  row: Pick<
    ConfigRow,
    | "id"
    | "name"
    | "baseUrl"
    | "apiFormat"
    | "visibility"
    | "enabled"
    | "apiKeyLastFour"
  >,
  models: ProviderModel[],
): OwnProviderConfig {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiFormat: row.apiFormat,
    visibility: row.visibility,
    enabled: row.enabled,
    apiKeyLastFour: row.apiKeyLastFour,
    models,
  };
}

function conflictOnName(): never {
  throw new AppError(
    "CONFLICT",
    409,
    "provider.nameTaken",
  );
}

async function requireOwnedConfig(
  id: string,
  actor: Actor,
): Promise<ConfigRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(providerConfigs)
    .where(
      and(
        eq(providerConfigs.id, id),
        eq(providerConfigs.ownerId, actor.userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "provider.notFound");
  }
  return row;
}

async function loadOwnConfig(
  id: string,
  actor: Actor,
): Promise<OwnProviderConfig> {
  const db = getDb();
  const rows = await db
    .select({
      config: {
        id: providerConfigs.id,
        name: providerConfigs.name,
        baseUrl: providerConfigs.baseUrl,
        apiFormat: providerConfigs.apiFormat,
        visibility: providerConfigs.visibility,
        enabled: providerConfigs.enabled,
        apiKeyLastFour: providerConfigs.apiKeyLastFour,
      },
      model: providerModelColumns,
    })
    .from(providerConfigs)
    .leftJoin(
      providerModels,
      eq(providerModels.providerConfigId, providerConfigs.id),
    )
    .where(
      and(
        eq(providerConfigs.id, id),
        eq(providerConfigs.ownerId, actor.userId),
      ),
    );
  const first = rows[0];
  if (!first) {
    throw new AppError("NOT_FOUND", 404, "provider.notFound");
  }
  const models: ProviderModel[] = await hydrateUnsourcedModels(
    rows.flatMap((row) => (row.model?.id ? [row.model] : [])),
  );
  return toOwnConfig(first.config, models);
}

export async function listProviderConfigs(
  actor: Actor,
): Promise<ProviderConfigList> {
  const db = getDb();
  const rows = await db
    .select({
      config: {
        id: providerConfigs.id,
        ownerId: providerConfigs.ownerId,
        name: providerConfigs.name,
        baseUrl: providerConfigs.baseUrl,
        apiFormat: providerConfigs.apiFormat,
        visibility: providerConfigs.visibility,
        enabled: providerConfigs.enabled,
        apiKeyLastFour: providerConfigs.apiKeyLastFour,
      },
      ownerName: users.username,
      model: providerModelColumns,
    })
    .from(providerConfigs)
    .innerJoin(users, eq(users.id, providerConfigs.ownerId))
    .leftJoin(
      providerModels,
      eq(providerModels.providerConfigId, providerConfigs.id),
    )
    .where(
      or(
        eq(providerConfigs.ownerId, actor.userId),
        eq(providerConfigs.visibility, "shared"),
      ),
    );

  const storedModels: StoredProviderModel[] = [];
  for (const row of rows) {
    if (row.model?.id) {
      storedModels.push(row.model);
    }
  }
  const hydrated = await hydrateUnsourcedModels(storedModels);
  const byId = new Map(hydrated.map((model) => [model.id, model]));

  const grouped = new Map<
    string,
    {
      config: (typeof rows)[number]["config"];
      ownerName: string;
      models: ProviderModel[];
    }
  >();
  for (const row of rows) {
    let entry = grouped.get(row.config.id);
    if (!entry) {
      entry = { config: row.config, ownerName: row.ownerName, models: [] };
      grouped.set(row.config.id, entry);
    }
    if (row.model?.id) {
      const model = byId.get(row.model.id);
      if (model) {
        entry.models.push(model);
      }
    }
  }

  const own: OwnProviderConfig[] = [];
  const shared: SharedProviderConfig[] = [];
  for (const entry of grouped.values()) {
    if (entry.config.ownerId === actor.userId) {
      own.push(toOwnConfig(entry.config, entry.models));
    } else {
      shared.push({
        id: entry.config.id,
        name: entry.config.name,
        ownerName: entry.ownerName,
        models: entry.models,
      });
    }
  }
  return { own, shared };
}

export async function createProviderConfig(
  input: CreateProviderConfigInput,
  actor: Actor,
): Promise<OwnProviderConfig> {
  const visibility = coerceVisibility(input.visibility, actor, "private");
  const apiKey = input.apiKey ?? null;
  assertApiKeyAvailable(input.apiFormat, apiKey !== null);
  const id = newId();
  const db = getDb();
  try {
    const inserted = await db
      .insert(providerConfigs)
      .values({
        id,
        ownerId: actor.userId,
        name: input.name,
        baseUrl: input.baseUrl,
        apiFormat: input.apiFormat,
        encryptedApiKey: apiKey ? encryptSecret(apiKey) : null,
        apiKeyLastFour: apiKey ? lastFour(apiKey) : null,
        visibility,
      })
      .returning({
        id: providerConfigs.id,
        name: providerConfigs.name,
        baseUrl: providerConfigs.baseUrl,
        apiFormat: providerConfigs.apiFormat,
        visibility: providerConfigs.visibility,
        enabled: providerConfigs.enabled,
        apiKeyLastFour: providerConfigs.apiKeyLastFour,
      });
    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL", 500, "provider.createFailed");
    }
    logger.info(
      { userId: actor.userId, configId: row.id, visibility: row.visibility },
      "provider config created",
    );
    return toOwnConfig(row, []);
  } catch (error) {
    if (isUniqueViolation(error)) {
      conflictOnName();
    }
    throw error;
  }
}

export async function updateProviderConfig(
  id: string,
  input: UpdateProviderConfigInput,
  actor: Actor,
): Promise<OwnProviderConfig> {
  const existing = await requireOwnedConfig(id, actor);
  const visibility = coerceVisibility(
    input.visibility,
    actor,
    existing.visibility,
  );
  const apiFormat = input.apiFormat ?? existing.apiFormat;
  // The rule is about the state *after* the patch: an explicit `null` clears
  // the key, an omitted field keeps the stored one.
  const hasKey =
    input.apiKey === null
      ? false
      : (typeof input.apiKey === "string" && input.apiKey.length > 0) ||
        existing.encryptedApiKey !== null;
  assertApiKeyAvailable(apiFormat, hasKey);
  const db = getDb();
  const patch: {
    name?: string;
    baseUrl?: string;
    apiFormat?: ProviderApiFormat;
    encryptedApiKey?: string | null;
    apiKeyLastFour?: string | null;
    filesApiUnsupportedAt?: Date | null;
    visibility: "private" | "shared";
    enabled?: boolean;
    updatedAt: Date;
  } = {
    visibility,
    updatedAt: new Date(),
  };
  if (input.enabled !== undefined) {
    patch.enabled = input.enabled;
  }
  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.baseUrl !== undefined) {
    patch.baseUrl = input.baseUrl;
  }
  if (input.apiFormat !== undefined) {
    patch.apiFormat = input.apiFormat;
  }
  if (input.apiKey !== undefined) {
    if (input.apiKey === null) {
      patch.encryptedApiKey = null;
      patch.apiKeyLastFour = null;
    } else {
      patch.encryptedApiKey = encryptSecret(input.apiKey);
      patch.apiKeyLastFour = lastFour(input.apiKey);
    }
  }
  // The Files API negative cache describes one endpoint with one credential —
  // any of the three changing invalidates it, so the config gets to try again.
  const endpointChanged =
    input.baseUrl !== undefined ||
    input.apiKey !== undefined ||
    input.apiFormat !== undefined;
  if (endpointChanged) {
    patch.filesApiUnsupportedAt = null;
  }

  try {
    const updated = await db
      .update(providerConfigs)
      .set(patch)
      .where(
        and(
          eq(providerConfigs.id, id),
          eq(providerConfigs.ownerId, actor.userId),
        ),
      )
      .returning({ id: providerConfigs.id });
    if (!updated[0]) {
      throw new AppError("NOT_FOUND", 404, "provider.notFound");
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      conflictOnName();
    }
    throw error;
  }

  logger.info(
    { userId: actor.userId, configId: id, visibility },
    "provider config updated",
  );
  return loadOwnConfig(id, actor);
}

export async function deleteProviderConfig(
  id: string,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  const deleted = await db
    .delete(providerConfigs)
    .where(
      and(
        eq(providerConfigs.id, id),
        eq(providerConfigs.ownerId, actor.userId),
      ),
    )
    .returning({ id: providerConfigs.id });
  if (!deleted[0]) {
    throw new AppError("NOT_FOUND", 404, "provider.notFound");
  }
  logger.info({ userId: actor.userId, configId: id }, "provider config deleted");
}

export async function addProviderModel(
  configId: string,
  input: AddProviderModelInput,
  actor: Actor,
): Promise<ProviderModel> {
  await requireOwnedConfig(configId, actor);
  const { modelId, ...overrides } = input;
  const fill = await fillMetadataForModelId(modelId);
  const hasOverrides = Object.values(overrides).some(
    (value) => value !== undefined,
  );
  let metadata: ModelMetadataFields = fill;
  if (hasOverrides) {
    metadata = {
      contextTokens: input.contextTokens ?? fill.contextTokens,
      outputTokens: input.outputTokens ?? fill.outputTokens,
      inputModalities: input.inputModalities ?? fill.inputModalities,
      outputModalities: input.outputModalities ?? fill.outputModalities,
      reasoning: input.reasoning ?? fill.reasoning,
      reasoningOptions: input.reasoningOptions ?? fill.reasoningOptions,
      vendorKey: input.vendorKey === undefined ? fill.vendorKey : input.vendorKey,
      metadataSource: "user",
    };
    if (metadata.reasoning && metadata.reasoningOptions.length === 0) {
      metadata = { ...metadata, reasoningOptions: [...SEEDED_REASONING_OPTIONS] };
    }
  }
  const db = getDb();
  try {
    const inserted = await db
      .insert(providerModels)
      .values({
        id: newId(),
        providerConfigId: configId,
        modelId,
        ...fillValues(metadata),
      })
      .returning(providerModelColumns);
    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL", 500, "provider.modelAddFailed");
    }
    return toProviderModel(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        409,
        "provider.modelExists",
      );
    }
    throw error;
  }
}

export async function updateProviderModel(
  configId: string,
  modelId: string,
  input: UpdateProviderModelInput,
  actor: Actor,
): Promise<ProviderModel> {
  await requireOwnedConfig(configId, actor);
  const db = getDb();
  const existingRows = await db
    .select(providerModelColumns)
    .from(providerModels)
    .where(
      and(
        eq(providerModels.providerConfigId, configId),
        eq(providerModels.modelId, modelId),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    throw new AppError("NOT_FOUND", 404, "model.notFound");
  }

  let next: ModelMetadataFields;
  if (input.resetFromCatalog) {
    next = await fillMetadataForModelId(modelId);
  } else {
    const current = toProviderModel(existing);
    next = {
      contextTokens: input.contextTokens ?? current.contextTokens,
      outputTokens: input.outputTokens ?? current.outputTokens,
      inputModalities: input.inputModalities ?? current.inputModalities,
      outputModalities: input.outputModalities ?? current.outputModalities,
      reasoning: input.reasoning ?? current.reasoning,
      reasoningOptions: input.reasoningOptions ?? current.reasoningOptions,
      vendorKey:
        input.vendorKey === undefined ? current.vendorKey : input.vendorKey,
      metadataSource: "user",
    };
    if (next.reasoning && next.reasoningOptions.length === 0) {
      next = { ...next, reasoningOptions: [...SEEDED_REASONING_OPTIONS] };
    }
  }

  const updated = await db
    .update(providerModels)
    .set({
      ...fillValues(next),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(providerModels.providerConfigId, configId),
        eq(providerModels.modelId, modelId),
      ),
    )
    .returning(providerModelColumns);
  const row = updated[0];
  if (!row) {
    throw new AppError("NOT_FOUND", 404, "model.notFound");
  }
  return toProviderModel(row);
}

export async function removeProviderModel(
  configId: string,
  modelId: string,
  actor: Actor,
): Promise<void> {
  await requireOwnedConfig(configId, actor);
  const db = getDb();
  const deleted = await db
    .delete(providerModels)
    .where(
      and(
        eq(providerModels.providerConfigId, configId),
        eq(providerModels.modelId, modelId),
      ),
    )
    .returning({ id: providerModels.id });
  if (!deleted[0]) {
    throw new AppError("NOT_FOUND", 404, "model.notFound");
  }
}

export async function discoverProviderModels(
  configId: string,
  actor: Actor,
): Promise<string[]> {
  const config = await requireOwnedConfig(configId, actor);
  const apiKey = config.encryptedApiKey
    ? decryptSecret(config.encryptedApiKey)
    : null;
  logger.info(
    { userId: actor.userId, configId },
    "provider discovery started",
  );
  return fetchServedModelIds({
    apiFormat: config.apiFormat,
    baseUrl: config.baseUrl,
    apiKey,
  });
}
