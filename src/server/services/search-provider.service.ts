import "server-only";

import { and, asc, eq, max } from "drizzle-orm";

import { newId } from "@/lib/id";
import type {
  ReorderSearchProvidersInput,
  SearchProvider,
  SearchProviderSetting,
  UpsertSearchProviderInput,
} from "@/lib/schemas/search-provider";
import type { Actor } from "@/server/auth/actor";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { searchProviderSettings } from "@/server/db/schema";
import { isUniqueViolation } from "@/server/db/unique-violation";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

type SettingRow = typeof searchProviderSettings.$inferSelect;

/** Decrypted credential for search execution. Never leaves the server. */
export type SearchProviderCredential = {
  provider: SearchProvider;
  apiKey: string;
  baseUrl: string | null;
};

function lastFour(value: string): string {
  return value.slice(-4);
}

function toSetting(row: SettingRow): SearchProviderSetting {
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKeyLastFour: row.apiKeyLastFour,
    position: row.position,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function listRows(actor: Actor): Promise<SettingRow[]> {
  const db = getDb();
  return db
    .select()
    .from(searchProviderSettings)
    .where(eq(searchProviderSettings.userId, actor.userId))
    .orderBy(asc(searchProviderSettings.position));
}

export async function listSearchProviderSettings(
  actor: Actor,
): Promise<SearchProviderSetting[]> {
  const rows = await listRows(actor);
  return rows.map(toSetting);
}

export async function upsertSearchProviderSetting(
  provider: SearchProvider,
  input: UpsertSearchProviderInput,
  actor: Actor,
): Promise<SearchProviderSetting> {
  const db = getDb();
  const existing = await db
    .select()
    .from(searchProviderSettings)
    .where(
      and(
        eq(searchProviderSettings.userId, actor.userId),
        eq(searchProviderSettings.provider, provider),
      ),
    )
    .limit(1);
  const row = existing[0];

  if (row) {
    const patch: {
      encryptedApiKey?: string;
      apiKeyLastFour?: string;
      baseUrl?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (input.apiKey !== undefined) {
      patch.encryptedApiKey = encryptSecret(input.apiKey);
      patch.apiKeyLastFour = lastFour(input.apiKey);
    }
    if (input.baseUrl !== undefined) {
      patch.baseUrl = input.baseUrl;
    }
    const updated = await db
      .update(searchProviderSettings)
      .set(patch)
      .where(
        and(
          eq(searchProviderSettings.userId, actor.userId),
          eq(searchProviderSettings.provider, provider),
        ),
      )
      .returning();
    const updatedRow = updated[0];
    if (!updatedRow) {
      throw new AppError("NOT_FOUND", 404, "Search provider not configured");
    }
    logger.info(
      { userId: actor.userId, provider },
      "search provider setting updated",
    );
    return toSetting(updatedRow);
  }

  if (input.apiKey === undefined) {
    throw new AppError(
      "VALIDATION_FAILED",
      400,
      "API key is required to add a search provider",
      { apiKey: "Required" },
    );
  }
  const positionRows = await db
    .select({ value: max(searchProviderSettings.position) })
    .from(searchProviderSettings)
    .where(eq(searchProviderSettings.userId, actor.userId));
  const position = (positionRows[0]?.value ?? -1) + 1;

  try {
    const inserted = await db
      .insert(searchProviderSettings)
      .values({
        id: newId(),
        userId: actor.userId,
        provider,
        encryptedApiKey: encryptSecret(input.apiKey),
        apiKeyLastFour: lastFour(input.apiKey),
        baseUrl: input.baseUrl ?? null,
        position,
      })
      .returning();
    const insertedRow = inserted[0];
    if (!insertedRow) {
      throw new AppError("INTERNAL", 500, "Failed to save search provider");
    }
    logger.info(
      { userId: actor.userId, provider },
      "search provider setting created",
    );
    return toSetting(insertedRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        409,
        "Search provider is already configured",
      );
    }
    throw error;
  }
}

export async function deleteSearchProviderSetting(
  provider: SearchProvider,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(searchProviderSettings)
      .where(
        and(
          eq(searchProviderSettings.userId, actor.userId),
          eq(searchProviderSettings.provider, provider),
        ),
      )
      .returning({ id: searchProviderSettings.id });
    if (!deleted[0]) {
      throw new AppError("NOT_FOUND", 404, "Search provider not configured");
    }
    // Compact positions back to 0..n-1 in the remaining order.
    const remaining = await tx
      .select()
      .from(searchProviderSettings)
      .where(eq(searchProviderSettings.userId, actor.userId))
      .orderBy(asc(searchProviderSettings.position));
    for (const [index, row] of remaining.entries()) {
      if (row.position !== index) {
        await tx
          .update(searchProviderSettings)
          .set({ position: index })
          .where(eq(searchProviderSettings.id, row.id));
      }
    }
  });
  logger.info(
    { userId: actor.userId, provider },
    "search provider setting deleted",
  );
}

export async function reorderSearchProviders(
  input: ReorderSearchProvidersInput,
  actor: Actor,
): Promise<SearchProviderSetting[]> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(searchProviderSettings)
      .where(eq(searchProviderSettings.userId, actor.userId))
      .orderBy(asc(searchProviderSettings.position));

    const requested = input.providers;
    const current = rows.map((row) => row.provider);
    const isPermutation =
      requested.length === current.length &&
      new Set(requested).size === current.length &&
      current.every((provider) => requested.includes(provider));
    if (!isPermutation) {
      throw new AppError(
        "VALIDATION_FAILED",
        400,
        "Order must list every configured search provider exactly once",
      );
    }

    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    const reordered: SettingRow[] = [];
    for (const [index, provider] of requested.entries()) {
      const row = byProvider.get(provider);
      if (!row) {
        throw new AppError(
          "VALIDATION_FAILED",
          400,
          "Order must list every configured search provider exactly once",
        );
      }
      if (row.position !== index) {
        const updated = await tx
          .update(searchProviderSettings)
          .set({ position: index, updatedAt: new Date() })
          .where(eq(searchProviderSettings.id, row.id))
          .returning();
        const updatedRow = updated[0];
        if (!updatedRow) {
          throw new AppError("INTERNAL", 500, "Failed to reorder providers");
        }
        reordered.push(updatedRow);
      } else {
        reordered.push(row);
      }
    }
    return reordered.map(toSetting);
  });
}

/**
 * Decrypted credentials in fallback-chain order, for search execution only.
 * The plaintext keys must never be logged, returned from a Route Handler, or
 * retained beyond the provider call.
 */
export async function resolveSearchProviderCredentials(
  actor: Actor,
): Promise<SearchProviderCredential[]> {
  const rows = await listRows(actor);
  return rows.map((row) => ({
    provider: row.provider,
    apiKey: decryptSecret(row.encryptedApiKey),
    baseUrl: row.baseUrl,
  }));
}
