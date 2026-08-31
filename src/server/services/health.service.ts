import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";

export async function checkHealth(): Promise<{ ok: true }> {
  const db = getDb();
  await db.execute(sql`select 1`);
  return { ok: true };
}
