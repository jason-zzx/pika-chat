import "server-only";

import { eq } from "drizzle-orm";

import {
  type ModelMetadataFields,
  type ProviderModel,
} from "@/lib/schemas/provider";
import { fillMetadataForModelId } from "@/server/ai/model-catalog";
import { getDb } from "@/server/db/client";
import { providerModels } from "@/server/db/schema";

export type StoredProviderModel = {
  id: string;
  modelId: string;
  contextTokens: number;
  outputTokens: number;
  inputModalities: unknown;
  outputModalities: unknown;
  reasoning: boolean;
  reasoningOptions: unknown;
  vendorKey: string | null;
  metadataSource: "catalog" | "default" | "user" | null;
};

export const providerModelColumns = {
  id: providerModels.id,
  modelId: providerModels.modelId,
  contextTokens: providerModels.contextTokens,
  outputTokens: providerModels.outputTokens,
  inputModalities: providerModels.inputModalities,
  outputModalities: providerModels.outputModalities,
  reasoning: providerModels.reasoning,
  reasoningOptions: providerModels.reasoningOptions,
  vendorKey: providerModels.vendorKey,
  metadataSource: providerModels.metadataSource,
};

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 || fallback.length === 0 ? strings : [...fallback];
}

export function toProviderModel(row: StoredProviderModel): ProviderModel {
  return {
    id: row.id,
    modelId: row.modelId,
    contextTokens: row.contextTokens,
    outputTokens: row.outputTokens,
    inputModalities: parseStringArray(row.inputModalities, ["text"]),
    outputModalities: parseStringArray(row.outputModalities, ["text"]),
    reasoning: row.reasoning,
    reasoningOptions: parseStringArray(row.reasoningOptions, []),
    vendorKey: row.vendorKey,
    metadataSource: row.metadataSource ?? "default",
  };
}

export async function hydrateUnsourcedModels(
  rows: StoredProviderModel[],
): Promise<ProviderModel[]> {
  const targets = rows.filter(
    (row) => row.metadataSource === null || row.metadataSource === "default",
  );
  if (targets.length === 0) {
    return rows.map(toProviderModel);
  }

  const db = getDb();
  const filled = new Map<string, StoredProviderModel>();
  for (const row of rows) {
    filled.set(row.id, row);
  }
  for (const row of targets) {
    const fill = await fillMetadataForModelId(row.modelId);
    if (row.metadataSource === "default" && fill.metadataSource !== "catalog") {
      continue;
    }
    await db
      .update(providerModels)
      .set({
        contextTokens: fill.contextTokens,
        outputTokens: fill.outputTokens,
        inputModalities: fill.inputModalities,
        outputModalities: fill.outputModalities,
        reasoning: fill.reasoning,
        reasoningOptions: fill.reasoningOptions,
        vendorKey: fill.vendorKey,
        metadataSource: fill.metadataSource,
        updatedAt: new Date(),
      })
      .where(eq(providerModels.id, row.id));
    filled.set(row.id, { ...row, ...fill });
  }
  return rows.map((row) => toProviderModel(filled.get(row.id) ?? row));
}

export function fillValues(fill: ModelMetadataFields) {
  return {
    contextTokens: fill.contextTokens,
    outputTokens: fill.outputTokens,
    inputModalities: fill.inputModalities,
    outputModalities: fill.outputModalities,
    reasoning: fill.reasoning,
    reasoningOptions: fill.reasoningOptions,
    vendorKey: fill.vendorKey,
    metadataSource: fill.metadataSource,
  };
}
