import "server-only";

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import { basename, fileExtension } from "@/lib/files/media-types";
import * as schema from "@/server/db/schema";
import { getEnv } from "@/server/env";

const shared = globalThis as { sqlite?: Database.Database };

let db: BetterSQLite3Database<typeof schema> | undefined;

function openSqlite(path: string): Database.Database {
  if (path !== ":memory:" && !path.startsWith("file:")) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.function("file_basename", { deterministic: true }, (name: unknown) =>
    typeof name === "string" ? basename(name) : "",
  );
  sqlite.function("file_extension", { deterministic: true }, (name: unknown) =>
    typeof name === "string" ? fileExtension(name) : "",
  );
  return sqlite;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    // One SQLite handle per process: module reloads (vi.resetModules, Next dev
    // HMR) must reuse the same instance, or `:memory:` gets a second empty DB
    // and file DBs open redundant handles.
    const sqlite = (shared.sqlite ??= openSqlite(getEnv().DATABASE_PATH));
    db = drizzle(sqlite, { schema });
  }

  return db;
}

/** Exposes the underlying better-sqlite3 handle for pragmas and import. */
export function getSqliteClient(): Database.Database {
  getDb();
  if (!shared.sqlite) {
    throw new Error("SQLite database client failed to initialize");
  }
  return shared.sqlite;
}

/** Closes the SQLite handle during graceful shutdown. */
export function closeDb(): void {
  shared.sqlite?.close();
  shared.sqlite = undefined;
  db = undefined;
}

export type DbClient = BetterSQLite3Database<typeof schema>;
export type DbTransaction = Parameters<
  Parameters<DbClient["transaction"]>[0]
>[0];
export type DbExecutor = DbClient | DbTransaction;
