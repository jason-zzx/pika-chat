import "server-only";

import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";
import { getEnv } from "@/server/env";

let db: PgDatabase<PgQueryResultHKT, typeof schema> | undefined;

const shared = globalThis as { pglite?: PGlite };

function databaseUrl(): string {
  const env = getEnv();
  if (process.env.VITEST && env.TEST_DATABASE_URL) {
    return env.TEST_DATABASE_URL;
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when PGLITE_DATA_DIR is unset");
  }
  return env.DATABASE_URL;
}

export function getDb(): PgDatabase<PgQueryResultHKT, typeof schema> {
  if (!db) {
    const dataDir = process.env.PGLITE_DATA_DIR;
    // One PGlite per process: module reloads (vi.resetModules, Next dev HMR)
    // must reuse the same instance, or they get a second, empty database.
    db = dataDir
      ? drizzlePglite((shared.pglite ??= new PGlite(dataDir)), { schema })
      : drizzle(postgres(databaseUrl()), { schema });
  }

  return db;
}

/** Closes the embedded PGlite instance during graceful local-mode shutdown. */
export async function closeDb(): Promise<void> {
  await shared.pglite?.close();
}

/** Driver-neutral normalization for `db.execute()` (postgres-js returns a row array, PGlite returns `{ rows }`). */
export function executeRows<T extends Record<string, unknown>>(
  result: unknown,
): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/** The pooled client, as a type (services accept `tx` to join a transaction). */
export type DbClient = ReturnType<typeof getDb>;
export type DbTransaction = Parameters<
  Parameters<DbClient["transaction"]>[0]
>[0];
