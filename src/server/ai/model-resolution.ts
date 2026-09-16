import "server-only";

import { and, eq, or } from "drizzle-orm";

import type { AvailableModel } from "@/lib/schemas/provider";
import {
  hydrateUnsourcedModels,
  providerModelColumns,
} from "@/server/ai/model-fill";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { providerConfigs, providerModels, users } from "@/server/db/schema";

export async function resolveAvailableModels(
  actor: Actor,
): Promise<AvailableModel[]> {
  const db = getDb();
  const rows = await db
    .select({
      configId: providerConfigs.id,
      configName: providerConfigs.name,
      ownerId: providerConfigs.ownerId,
      ownerName: users.username,
      model: providerModelColumns,
    })
    .from(providerModels)
    .innerJoin(
      providerConfigs,
      eq(providerModels.providerConfigId, providerConfigs.id),
    )
    .innerJoin(users, eq(users.id, providerConfigs.ownerId))
    .where(
      and(
        // A disabled config hides its models everywhere — pickers here, and
        // createChatModelHandle rejects the pair since it gates on this list.
        eq(providerConfigs.enabled, true),
        or(
          eq(providerConfigs.ownerId, actor.userId),
          eq(providerConfigs.visibility, "shared"),
        ),
      ),
    );

  const hydrated = await hydrateUnsourcedModels(rows.map((row) => row.model));
  const byId = new Map(hydrated.map((model) => [model.id, model]));

  return rows.flatMap((row) => {
    const model = byId.get(row.model.id);
    if (!model) {
      return [];
    }
    const provenance = row.ownerId === actor.userId ? "own" : "shared";
    return [
      {
        configId: row.configId,
        configName: row.configName,
        modelId: model.modelId,
        provenance,
        ownerName: provenance === "shared" ? row.ownerName : null,
        contextTokens: model.contextTokens,
        outputTokens: model.outputTokens,
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
        reasoning: model.reasoning,
        reasoningOptions: model.reasoningOptions,
        vendorKey: model.vendorKey,
        metadataSource: model.metadataSource,
      },
    ];
  });
}
