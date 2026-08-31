import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";
import { getEnv } from "@/server/env";

let client: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function databaseUrl(): string {
  const env = getEnv();
  if (process.env.VITEST && env.TEST_DATABASE_URL) {
    return env.TEST_DATABASE_URL;
  }
  return env.DATABASE_URL;
}

export function getDb() {
  if (!db) {
    client = postgres(databaseUrl());
    db = drizzle(client, { schema });
  }

  return db;
}
