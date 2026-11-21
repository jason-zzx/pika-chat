import "server-only";

import { sql } from "drizzle-orm";

import pkg from "../../../package.json";

import { getDb } from "@/server/db/client";

export async function checkHealth(): Promise<{ ok: true; version: string }> {
  const db = getDb();
  db.get(sql`select 1`);
  return { ok: true, version: pkg.version };
}
