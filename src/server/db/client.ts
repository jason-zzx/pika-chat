import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { appSettings } from "@/server/db/schema/app-settings";
import { getEnv } from "@/server/env";

const schema = { appSettings };

let client: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!db) {
    const env = getEnv();
    client = postgres(env.DATABASE_URL);
    db = drizzle(client, { schema });
  }

  return db;
}
