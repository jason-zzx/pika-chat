import "server-only";

import type Database from "better-sqlite3";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";

import { getSqliteClient } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { APP_SETTINGS_ROW_ID } from "@/server/db/schema/app-settings";
import {
  POSTGRES_IMPORT_ROW_ID,
  type PostgresImportSourceInfo,
} from "@/server/db/schema/postgres-import";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

const BATCH_SIZE = 1_000;

/**
 * All tables migrated from PostgreSQL in parent-first order. `message_file_refs`
 * is intentionally omitted because it is SQLite-only and populated by the
 * `chat_messages_file_refs_ai` trigger as `chat_messages` rows are inserted;
 * `postgres_import` is the import marker written inside the same transaction.
 */
export const PG_IMPORT_TABLES = [
  "app_settings",
  "users",
  "sessions",
  "accounts",
  "verifications",
  "two_factors",
  "provider_configs",
  "provider_models",
  "assistants",
  "topics",
  "chat_messages",
  "chat_generations",
  "files",
  "provider_file_delete_retries",
  "search_provider_settings",
  "demo_usage_counters",
] as const;

type ImportTableName = (typeof PG_IMPORT_TABLES)[number];

type ColumnDataType = "boolean" | "date" | "json" | "number" | "string";

export type PostgresImportSource = {
  listColumns(tables: readonly string[]): Promise<Record<string, string[]>>;
  countRows(table: ImportTableName): Promise<number>;
  streamRows(
    table: ImportTableName,
    batchSize: number,
    onBatch: (rows: Record<string, unknown>[]) => void,
  ): Promise<void>;
};

export type OpenPostgresSource = (
  databaseUrl: string,
  fn: (source: PostgresImportSource) => Promise<PostgresImportResult>,
) => Promise<PostgresImportResult>;

export type PostgresImportResult =
  | { status: "skipped"; reason: "noDatabaseUrl" | "alreadyImported" }
  | { status: "imported"; rowCounts: Record<string, number>; messageFileRefs: number };

const schemaColumns = buildSchemaColumnTypes();

function buildSchemaColumnTypes(): Map<string, Map<string, ColumnDataType>> {
  const tables = new Map<string, Map<string, ColumnDataType>>();
  for (const value of Object.values(schema)) {
    if (!is(value, SQLiteTable)) {
      continue;
    }
    const config = getTableConfig(value);
    const cols = new Map<string, ColumnDataType>();
    for (const column of config.columns) {
      cols.set(column.name, column.dataType as ColumnDataType);
    }
    tables.set(config.name, cols);
  }
  return tables;
}

export function sanitizeSourceInfo(databaseUrl: string): PostgresImportSourceInfo {
  try {
    const parsed = new URL(databaseUrl);
    const database = parsed.pathname.replace(/^\//, "");
    return {
      host: parsed.host.length > 0 ? parsed.host : null,
      database: database.length > 0 ? database : null,
    };
  } catch {
    return { host: null, database: null };
  }
}

export function mapPgValueToSqlite(
  dataType: ColumnDataType,
  value: unknown,
  context: string,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (dataType) {
    case "boolean": {
      if (typeof value === "boolean") {
        return value ? 1 : 0;
      }
      if (typeof value === "number" && (value === 0 || value === 1)) {
        return value;
      }
      throw new Error(`Expected boolean for ${context}, received ${typeof value}`);
    }
    case "date": {
      if (value instanceof Date) {
        const ms = value.getTime();
        if (!Number.isFinite(ms)) {
          throw new Error(`Invalid Date for ${context}`);
        }
        return ms;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
      }
      if (typeof value === "string") {
        const ms = Date.parse(value);
        if (Number.isFinite(ms)) {
          return ms;
        }
      }
      throw new Error(`Expected timestamp for ${context}, received ${typeof value}`);
    }
    case "json":
      // Preserve PostgreSQL JSON strings/numbers/booleans as valid SQLite JSON.
      return JSON.stringify(value);
    case "number": {
      if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
          throw new Error(`Unsafe integer for ${context}: ${value}`);
        }
        return value;
      }
      if (typeof value === "bigint") {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
          throw new Error(`Unsafe bigint for ${context}: ${value}`);
        }
        return parsed;
      }
      if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
          throw new Error(`Unsafe numeric string for ${context}: ${value}`);
        }
        return parsed;
      }
      throw new Error(`Expected integer for ${context}, received ${typeof value}`);
    }
    case "string": {
      // `demo_usage_counters.day` was PostgreSQL `date` (parsed to Date by postgres.js).
      if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) {
          throw new Error(`Invalid Date for ${context}`);
        }
        return value.toISOString().slice(0, 10);
      }
      if (typeof value === "string") {
        return value;
      }
      throw new Error(`Expected string for ${context}, received ${typeof value}`);
    }
  }
}

function pragmaColumns(sqlite: Database.Database, table: string): string[] {
  const rows = sqlite
    .prepare(`pragma table_info("${table}")`)
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function hasImportMarker(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("select 1 from postgres_import where id = ? limit 1")
    .get(POSTGRES_IMPORT_ROW_ID);
  return row !== undefined;
}

function findNonEmptyTargetTable(sqlite: Database.Database): string | null {
  const appRow = sqlite
    .prepare("select 1 from app_settings where id != ? limit 1")
    .get(APP_SETTINGS_ROW_ID);
  if (appRow !== undefined) {
    return "app_settings";
  }

  for (const table of [...PG_IMPORT_TABLES, "message_file_refs"] as const) {
    if (table === "app_settings") {
      continue;
    }
    const row = sqlite.prepare(`select 1 from "${table}" limit 1`).get();
    if (row !== undefined) {
      return table;
    }
  }
  return null;
}

function verifyColumnSets(
  sqlite: Database.Database,
  pgColumnsByTable: Record<string, string[]>,
): Map<ImportTableName, Array<{ name: string; dataType: ColumnDataType }>> {
  const resolved = new Map<
    ImportTableName,
    Array<{ name: string; dataType: ColumnDataType }>
  >();

  for (const table of PG_IMPORT_TABLES) {
    const sqliteCols = pragmaColumns(sqlite, table);
    const pgCols = pgColumnsByTable[table] ?? [];
    if (pgCols.length === 0) {
      throw new Error(
        `PostgreSQL table "${table}" is missing in the source database; cannot import.`,
      );
    }

    const sqliteSet = new Set(sqliteCols);
    const pgSet = new Set(pgCols);
    const missingInPg = sqliteCols.filter((col) => !pgSet.has(col));
    const extraInPg = pgCols.filter((col) => !sqliteSet.has(col));
    if (missingInPg.length > 0 || extraInPg.length > 0) {
      throw new Error(
        `Schema mismatch for table "${table}" (missing in PostgreSQL: [${missingInPg.join(", ")}]; unexpected in PostgreSQL: [${extraInPg.join(", ")}]). Ensure both schemas match before importing.`,
      );
    }

    const typeMap = schemaColumns.get(table);
    if (!typeMap) {
      throw new Error(`Missing Drizzle SQLite table metadata for "${table}"`);
    }
    resolved.set(
      table,
      sqliteCols.map((name) => {
        const dataType = typeMap.get(name);
        if (!dataType) {
          throw new Error(`Missing Drizzle column metadata for ${table}.${name}`);
        }
        return { name, dataType };
      }),
    );
  }
  return resolved;
}

const defaultOpenPostgresSource: OpenPostgresSource = async (databaseUrl, fn) => {
  const { default: postgres } = await import("postgres");
  const pg = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 15,
    idle_timeout: 5,
  });

  try {
    return await pg.begin("read only isolation level repeatable read", async (pgTx) => {
      const source: PostgresImportSource = {
        async listColumns(tables) {
          const rows = await pgTx<{ table_name: string; column_name: string }[]>`
            select table_name, column_name
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = any(${[...tables]})
            order by table_name, ordinal_position
          `;
          const grouped: Record<string, string[]> = {};
          for (const row of rows) {
            (grouped[row.table_name] ??= []).push(row.column_name);
          }
          return grouped;
        },
        async countRows(table) {
          const rows = await pgTx.unsafe<{ count: number }[]>(
            `select count(*)::int as count from "${table}"`,
          );
          return rows[0]?.count ?? 0;
        },
        async streamRows(table, batchSize, onBatch) {
          for await (const batch of pgTx
            .unsafe<Record<string, unknown>[]>(`select * from "${table}"`)
            .cursor(batchSize)) {
            onBatch(batch);
          }
        },
      };
      return fn(source);
    });
  } finally {
    await pg.end();
  }
};

function sqliteRowCount(sqlite: Database.Database, table: string): number {
  const row = sqlite
    .prepare(`select count(*) as count from "${table}"`)
    .get() as { count: number };
  return row.count;
}

/**
 * Runs a one-time, read-only copy from PostgreSQL into the empty SQLite
 * database when `DATABASE_URL` is configured and the `postgres_import` marker
 * does not yet exist.
 */
export async function importFromPostgres(
  databaseUrl: string,
  options?: {
    sqlite?: Database.Database;
    openSource?: OpenPostgresSource;
  },
): Promise<PostgresImportResult> {
  const sqlite = options?.sqlite ?? getSqliteClient();
  const openSource = options?.openSource ?? defaultOpenPostgresSource;

  if (hasImportMarker(sqlite)) {
    logger.info("postgres import skipped; marker already present");
    return { status: "skipped", reason: "alreadyImported" };
  }

  const nonEmptyTable = findNonEmptyTargetTable(sqlite);
  if (nonEmptyTable) {
    throw new Error(
      `Refusing PostgreSQL import: target SQLite table "${nonEmptyTable}" is not empty. Remove DATABASE_URL to use the existing SQLite database, or start with a fresh database file.`,
    );
  }

  const sourceInfo = sanitizeSourceInfo(databaseUrl);
  logger.info(sourceInfo, "starting one-time PostgreSQL to SQLite import");

  return openSource(databaseUrl, async (source) => {
    const pgColumns = await source.listColumns(PG_IMPORT_TABLES);
    const tableColumns = verifyColumnSets(sqlite, pgColumns);

    // `PRAGMA foreign_keys` is ignored inside a SQLite transaction, so toggle
    // it outside `BEGIN IMMEDIATE ... COMMIT` and verify with `foreign_key_check`.
    sqlite.pragma("foreign_keys = OFF");
    const rowCounts: Record<string, number> = {};

    try {
      sqlite.exec("BEGIN IMMEDIATE");

      for (const table of PG_IMPORT_TABLES) {
        const columns = tableColumns.get(table)!;
        const expectedCount = await source.countRows(table);
        if (table === "app_settings" && expectedCount > 0) {
          sqlite.prepare("delete from app_settings").run();
        }

        const quotedCols = columns.map((c) => `"${c.name}"`).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const insertStmt = sqlite.prepare(
          `insert into "${table}" (${quotedCols}) values (${placeholders})`,
        );

        let copied = 0;
        await source.streamRows(table, BATCH_SIZE, (batch) => {
          for (const row of batch) {
            const params = columns.map((col) =>
              mapPgValueToSqlite(col.dataType, row[col.name], `${table}.${col.name}`),
            );
            insertStmt.run(...params);
          }
          copied += batch.length;
        });

        const actualCount = sqliteRowCount(sqlite, table);
        if (copied !== expectedCount) {
          throw new Error(
            `PostgreSQL import count mismatch while reading "${table}": expected ${expectedCount}, read ${copied}`,
          );
        }
        // When PG `app_settings` has 0 rows, SQLite keeps its seeded singleton row.
        const expectedSqliteCount =
          table === "app_settings" && expectedCount === 0 ? 1 : expectedCount;
        if (actualCount !== expectedSqliteCount) {
          throw new Error(
            `SQLite row count mismatch after importing "${table}": expected ${expectedSqliteCount}, found ${actualCount}`,
          );
        }

        rowCounts[table] = copied;
        logger.info({ table, rows: copied }, "postgres import table copied");
      }

      const fkViolations = sqlite.pragma("foreign_key_check") as Array<{
        table: string;
        rowid: number;
        parent: string;
        fkid: number;
      }>;
      if (fkViolations.length > 0) {
        const first = fkViolations[0]!;
        throw new Error(
          `Foreign key check failed after PostgreSQL import (${fkViolations.length} violation(s), first: ${first.table} rowid ${first.rowid} -> ${first.parent})`,
        );
      }

      sqlite
        .prepare(
          "insert into postgres_import (id, imported_at, source_info, row_counts) values (?, ?, ?, ?)",
        )
        .run(
          POSTGRES_IMPORT_ROW_ID,
          Date.now(),
          JSON.stringify(sourceInfo),
          JSON.stringify(rowCounts),
        );

      sqlite.exec("COMMIT");

      const messageFileRefs = sqliteRowCount(sqlite, "message_file_refs");
      logger.info(
        { rowCounts, messageFileRefs },
        "PostgreSQL to SQLite import completed",
      );
      return { status: "imported", rowCounts, messageFileRefs };
    } catch (error) {
      if (sqlite.inTransaction) {
        sqlite.exec("ROLLBACK");
      }
      throw error;
    } finally {
      sqlite.pragma("foreign_keys = ON");
    }
  });
}

/** Boot hook: imports from `DATABASE_URL` once when configured. */
export async function maybeImportPostgres(): Promise<PostgresImportResult> {
  const databaseUrl = getEnv().DATABASE_URL;
  if (!databaseUrl) {
    return { status: "skipped", reason: "noDatabaseUrl" };
  }
  return importFromPostgres(databaseUrl);
}
