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

// Every table except the SQLite-only ones: `message_file_refs` is derived (the
// chat_messages triggers fill it as messages land) and `postgres_import` is
// the marker. Foreign keys are off during the copy, so the order is free.
// Columns added after the SQLite switch (`topics.temporary`) do not exist in a
// v0.4.2 PostgreSQL source and stay at their SQLite defaults.
const IMPORT_TABLES = Object.values(schema).flatMap((entry) => {
  if (
    !is(entry, SQLiteTable) ||
    entry === schema.messageFileRefs ||
    entry === schema.postgresImport
  ) {
    return [];
  }
  const { name, columns } = getTableConfig(entry);
  return [
    {
      name,
      columns: columns.filter(
        (column) => !(name === "topics" && column.name === "temporary"),
      ),
    },
  ];
});

export const PG_IMPORT_TABLES = IMPORT_TABLES.map((table) => table.name);

/** Read side of the import; the default opens postgres.js, tests pass a fake. */
export type PostgresImportSource = {
  /** Column names per table of the current PostgreSQL schema. */
  listColumns(): Promise<Record<string, string[]>>;
  countRows(table: string): Promise<number>;
  streamRows(
    table: string,
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
  | { status: "imported"; rowCounts: Record<string, number> };

/** Host and database name only: the marker and logs never see credentials. */
export function sanitizeSourceInfo(
  databaseUrl: string,
): PostgresImportSourceInfo {
  const url = URL.parse(databaseUrl);
  return {
    host: url?.host || null,
    database: url?.pathname.slice(1) || null,
  };
}

/**
 * Maps a postgres.js value onto the SQLite column's storage form. JSON columns
 * are stringified by target column type, not JS type, so a PostgreSQL JSON
 * string or number stays a quoted JSON value. PostgreSQL `date` (demo counter
 * days) arrives as a UTC-midnight Date and is stored as `YYYY-MM-DD`; int8
 * arrives as a string.
 */
export function mapPgValueToSqlite(dataType: string, value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (dataType === "json") {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return dataType === "string"
      ? value.toISOString().slice(0, 10)
      : value.getTime();
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (dataType === "number" && typeof value === "string") {
    return Number(value);
  }
  return value;
}

const openPostgresSource: OpenPostgresSource = async (databaseUrl, fn) => {
  const { default: postgres } = await import("postgres");
  const pg = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
  try {
    await pg`select 1`.catch((error: unknown) => {
      throw new Error(
        "Cannot connect to the previous PostgreSQL database for the one-time import into SQLite. Keep PostgreSQL running with its existing connection settings for the first boot of this version.",
        { cause: error },
      );
    });
    // One read-only snapshot: every count and row is from the same instant.
    return await pg.begin(
      "read only isolation level repeatable read",
      (tx) =>
        fn({
          async listColumns() {
            const rows = await tx<{ table_name: string; column_name: string }[]>`
              select table_name, column_name
              from information_schema.columns
              where table_schema = current_schema()
            `;
            const columns: Record<string, string[]> = {};
            for (const row of rows) {
              (columns[row.table_name] ??= []).push(row.column_name);
            }
            return columns;
          },
          async countRows(table) {
            // count(*) is int8, which postgres.js returns as a string.
            const [row] = await tx<{ count: string }[]>`
              select count(*) as count from ${tx(table)}
            `;
            return Number(row?.count);
          },
          async streamRows(table, batchSize, onBatch) {
            for await (const rows of tx<Record<string, unknown>[]>`
              select * from ${tx(table)}
            `.cursor(batchSize)) {
              onBatch(rows);
            }
          },
        }),
    );
  } finally {
    await pg.end();
  }
};

/**
 * One-time copy from PostgreSQL into the empty SQLite database. The marker is
 * written in the same SQLite transaction as the rows, so a failure leaves
 * SQLite empty and the next boot retries. PostgreSQL is only read.
 */
export async function importFromPostgres(
  databaseUrl: string,
  options?: {
    sqlite?: Database.Database;
    openSource?: OpenPostgresSource;
  },
): Promise<PostgresImportResult> {
  const sqlite = options?.sqlite ?? getSqliteClient();

  if (sqlite.prepare("select 1 from postgres_import").get() !== undefined) {
    logger.info(
      "PostgreSQL data was already imported into SQLite: the PostgreSQL connection settings are ignored and PostgreSQL can be removed",
    );
    return { status: "skipped", reason: "alreadyImported" };
  }

  // The baseline migration seeds the singleton app_settings row; the source
  // row replaces it, so only a different row counts as existing data.
  const nonEmptyTable = PG_IMPORT_TABLES.find((name) =>
    name === "app_settings"
      ? sqlite
          .prepare("select 1 from app_settings where id != ?")
          .get(APP_SETTINGS_ROW_ID) !== undefined
      : sqlite.prepare(`select 1 from "${name}"`).get() !== undefined,
  );
  if (nonEmptyTable !== undefined) {
    throw new Error(
      `Refusing the PostgreSQL import: SQLite table "${nonEmptyTable}" already holds data. Remove the PostgreSQL connection settings to keep the existing SQLite database, or point DATABASE_PATH at a new file.`,
    );
  }

  const sourceInfo = sanitizeSourceInfo(databaseUrl);
  logger.info(sourceInfo, "starting one-time PostgreSQL to SQLite import");

  const openSource = options?.openSource ?? openPostgresSource;
  return openSource(databaseUrl, async (source) => {
    const pgColumns = await source.listColumns();
    for (const table of IMPORT_TABLES) {
      const sqliteColumns = table.columns.map((column) => column.name);
      const pgTableColumns = pgColumns[table.name] ?? [];
      const missing = sqliteColumns.filter(
        (name) => !pgTableColumns.includes(name),
      );
      const unexpected = pgTableColumns.filter(
        (name) => !sqliteColumns.includes(name),
      );
      if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(
          `PostgreSQL table "${table.name}" is not on the expected schema (missing columns: [${missing.join(", ")}]; unexpected columns: [${unexpected.join(", ")}]). Upgrade to v0.4.2 first so PostgreSQL is on the expected schema, then start this version again.`,
        );
      }
    }

    // A foreign_keys change is a no-op inside a transaction: switch it off
    // before BEGIN and let foreign_key_check validate the copy before COMMIT.
    // Holding a manual transaction across awaited PostgreSQL reads is safe
    // only because Next awaits register() before serving and the generation
    // runner starts after the import: nothing else uses this connection.
    sqlite.pragma("foreign_keys = OFF");
    try {
      sqlite.exec("BEGIN IMMEDIATE");
      sqlite.prepare("delete from app_settings").run();

      const rowCounts: Record<string, number> = {};
      for (const table of IMPORT_TABLES) {
        const pgCount = await source.countRows(table.name);
        const columnList = table.columns
          .map((column) => `"${column.name}"`)
          .join(", ");
        const placeholders = table.columns.map(() => "?").join(", ");
        const insert = sqlite.prepare(
          `insert into "${table.name}" (${columnList}) values (${placeholders})`,
        );
        await source.streamRows(table.name, BATCH_SIZE, (rows) => {
          for (const row of rows) {
            insert.run(
              ...table.columns.map((column) =>
                mapPgValueToSqlite(column.dataType, row[column.name]),
              ),
            );
          }
        });

        const sqliteCount = sqlite
          .prepare<[], number>(`select count(*) from "${table.name}"`)
          .pluck()
          .get();
        if (sqliteCount !== pgCount) {
          throw new Error(
            `Row count mismatch after copying "${table.name}": PostgreSQL has ${pgCount}, SQLite has ${sqliteCount}`,
          );
        }
        rowCounts[table.name] = pgCount;
        logger.info(
          { table: table.name, rows: pgCount },
          "copied PostgreSQL table into SQLite",
        );
      }

      const violations = sqlite
        .prepare<[], { table: string; parent: string }>(
          "pragma foreign_key_check",
        )
        .all();
      const [first] = violations;
      if (first !== undefined) {
        throw new Error(
          `Foreign key check failed after copying PostgreSQL data: ${violations.length} violation(s), first in "${first.table}" referencing "${first.parent}"`,
        );
      }

      sqlite
        .prepare(
          "insert into postgres_import (id, source_info, row_counts) values (?, ?, ?)",
        )
        .run(
          POSTGRES_IMPORT_ROW_ID,
          JSON.stringify(sourceInfo),
          JSON.stringify(rowCounts),
        );
      sqlite.exec("COMMIT");

      logger.info({ rowCounts }, "PostgreSQL to SQLite import completed");
      return { status: "imported", rowCounts };
    } finally {
      if (sqlite.inTransaction) {
        sqlite.exec("ROLLBACK");
      }
      sqlite.pragma("foreign_keys = ON");
    }
  });
}

/** Boot hook: imports once from the previous PostgreSQL connection (`DATABASE_URL` or `POSTGRES_*`), when one is configured. */
export async function maybeImportPostgres(): Promise<PostgresImportResult> {
  const databaseUrl = getEnv().DATABASE_URL;
  if (databaseUrl === undefined) {
    return { status: "skipped", reason: "noDatabaseUrl" };
  }
  return importFromPostgres(databaseUrl);
}
