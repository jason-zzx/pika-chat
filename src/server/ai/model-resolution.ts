import "server-only";

import { eq, or } from "drizzle-orm";

import type { AvailableModel } from "@/lib/schemas/provider";
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
      modelId: providerModels.modelId,
    })
    .from(providerModels)
    .innerJoin(
      providerConfigs,
      eq(providerModels.providerConfigId, providerConfigs.id),
    )
    .innerJoin(users, eq(users.id, providerConfigs.ownerId))
    .where(
      or(
        eq(providerConfigs.ownerId, actor.userId),
        eq(providerConfigs.visibility, "shared"),
      ),
    );

  return rows.map((row) => {
    const provenance = row.ownerId === actor.userId ? "own" : "shared";
    return {
      configId: row.configId,
      configName: row.configName,
      modelId: row.modelId,
      provenance,
      ownerName: provenance === "shared" ? row.ownerName : null,
    };
  });
}
