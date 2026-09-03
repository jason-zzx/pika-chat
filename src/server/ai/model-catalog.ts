import "server-only";

import { z } from "zod";

import {
  isCatalogFirstPartyProvider,
  vendorKeyFromCatalogProvider,
  vendorKeyFromModelId,
  type ModelVendorKey,
} from "@/lib/model-vendor";
import {
  DEFAULT_MODEL_CONTEXT_TOKENS,
  DEFAULT_MODEL_OUTPUT_TOKENS,
  defaultModelMetadata,
  type ModelMetadataFields,
} from "@/lib/schemas/provider";
import { logger } from "@/server/logger";

const MODELS_DEV_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const catalogModelSchema = z
  .object({
    reasoning: z.boolean().optional(),
    reasoning_options: z.array(z.unknown()).optional(),
    modalities: z
      .object({
        input: z.array(z.string()).optional(),
        output: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    limit: z
      .object({
        context: z.number().optional(),
        output: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type CatalogModel = z.infer<typeof catalogModelSchema>;

type CatalogProvider = {
  id: string;
  models: Record<string, CatalogModel>;
};

type Catalog = Record<string, CatalogProvider>;

type CatalogCache = {
  fetchedAt: number;
  catalog: Catalog;
};

let cache: CatalogCache | null = null;

export function resetModelCatalogCache(): void {
  cache = null;
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function lastSegment(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.trunc(value);
}

function effortOptions(model: CatalogModel): string[] {
  const options = model.reasoning_options ?? [];
  if (
    options.length > 0 &&
    options.every((item): item is string => typeof item === "string")
  ) {
    return options.filter((item) => item.length > 0);
  }
  for (const option of options) {
    const record = asRecord(option);
    if (!record || record.type !== "effort") {
      continue;
    }
    if (!Array.isArray(record.values)) {
      continue;
    }
    const values = record.values.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    if (values.length > 0) {
      return values;
    }
  }
  return [];
}

function hitToMetadata(
  providerId: string,
  modelId: string,
  model: CatalogModel,
): ModelMetadataFields {
  const input = model.modalities?.input;
  const output = model.modalities?.output;
  return {
    contextTokens: positiveInt(
      model.limit?.context,
      DEFAULT_MODEL_CONTEXT_TOKENS,
    ),
    outputTokens: positiveInt(model.limit?.output, DEFAULT_MODEL_OUTPUT_TOKENS),
    inputModalities: input && input.length > 0 ? input : ["text"],
    outputModalities: output && output.length > 0 ? output : ["text"],
    reasoning: model.reasoning ?? false,
    reasoningOptions: effortOptions(model),
    vendorKey: vendorKeyFromCatalogProvider(providerId, modelId),
    metadataSource: "catalog",
  };
}

function matchScore(
  query: string,
  catalogId: string,
  providerId: string,
  queryVendor: ModelVendorKey | null,
): number | null {
  const queryLower = query.toLowerCase();
  const catalogLower = catalogId.toLowerCase();
  const catalogSeg = lastSegment(catalogId).toLowerCase();
  const querySeg = lastSegment(query).toLowerCase();
  if (catalogLower !== queryLower && catalogSeg !== querySeg) {
    return null;
  }
  let score = 100;
  if (catalogSeg === queryLower || catalogSeg === querySeg) {
    score += 50;
  }
  if (catalogId === query) {
    score += 20;
  }
  if (isCatalogFirstPartyProvider(providerId)) {
    score += 80;
  }
  if (
    queryVendor !== null &&
    vendorKeyFromCatalogProvider(providerId, query) === queryVendor
  ) {
    // Several providers can host the same model id with equal base scores
    // (e.g. glm-5.2 on sensenova, zai, alibaba, zhipuai). Prefer the one
    // whose vendor matches what the model id itself implies, so the stored
    // vendor key and icon stay deterministic regardless of JSON key order.
    score += 30;
  }
  if (!catalogId.includes("/")) {
    score += 10;
  }
  return score;
}

function matchModel(
  catalog: Catalog,
  modelId: string,
): { providerId: string; model: CatalogModel } | null {
  const queryVendor = vendorKeyFromModelId(modelId);
  let best: { providerId: string; model: CatalogModel; score: number } | null =
    null;
  for (const provider of Object.values(catalog)) {
    for (const [catalogId, model] of Object.entries(provider.models)) {
      const score = matchScore(modelId, catalogId, provider.id, queryVendor);
      if (score === null) {
        continue;
      }
      if (!best || score > best.score) {
        best = { providerId: provider.id, model, score };
      }
    }
  }
  if (!best) {
    return null;
  }
  return { providerId: best.providerId, model: best.model };
}

function catalogFromUnknown(parsed: unknown): Catalog | null {
  const root = asRecord(parsed);
  if (!root) {
    return null;
  }
  const catalog: Catalog = {};
  for (const [providerKey, providerValue] of Object.entries(root)) {
    const provider = asRecord(providerValue);
    if (!provider) {
      continue;
    }
    const modelsRecord = asRecord(provider.models);
    if (!modelsRecord) {
      continue;
    }
    const models: Record<string, CatalogModel> = {};
    for (const [id, modelValue] of Object.entries(modelsRecord)) {
      const parsedModel = catalogModelSchema.safeParse(modelValue);
      if (parsedModel.success) {
        models[id] = parsedModel.data;
      }
    }
    catalog[providerKey] = {
      id: typeof provider.id === "string" ? provider.id : providerKey,
      models,
    };
  }
  return catalog;
}

async function loadCatalog(): Promise<Catalog | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.catalog;
  }

  let response: Response;
  try {
    response = await fetch(MODELS_DEV_URL, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(
      { timedOut: isTimeoutError(error) },
      "models.dev catalog fetch failed",
    );
    return null;
  }

  if (!response.ok) {
    if (response.body) {
      await response.body.cancel();
    }
    logger.warn(
      { status: response.status },
      "models.dev catalog fetch failed",
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    logger.warn("models.dev catalog fetch failed");
    return null;
  }

  const catalog = catalogFromUnknown(parsed);
  if (!catalog) {
    logger.warn("models.dev catalog fetch failed");
    return null;
  }

  cache = { fetchedAt: Date.now(), catalog };
  return catalog;
}

export async function lookupModelMetadata(
  modelId: string,
): Promise<ModelMetadataFields | null> {
  const catalog = await loadCatalog();
  if (!catalog) {
    return null;
  }
  const matched = matchModel(catalog, modelId);
  if (!matched) {
    return null;
  }
  return hitToMetadata(matched.providerId, modelId, matched.model);
}

export async function fillMetadataForModelId(
  modelId: string,
): Promise<ModelMetadataFields> {
  const hit = await lookupModelMetadata(modelId);
  if (hit) {
    return hit;
  }
  return defaultModelMetadata();
}
