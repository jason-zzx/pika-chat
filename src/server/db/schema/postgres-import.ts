import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { timestampMsDefaultNow } from "./columns";

export const POSTGRES_IMPORT_ROW_ID = "singleton";

export type PostgresImportSourceInfo = {
  host: string | null;
  database: string | null;
};

/**
 * One-time boot marker recorded inside the same SQLite transaction as the
 * PostgreSQL-to-SQLite data copy so subsequent boots skip re-importing.
 */
export const postgresImport = sqliteTable("postgres_import", {
  id: text("id").primaryKey(),
  importedAt: timestampMsDefaultNow("imported_at"),
  sourceInfo: text("source_info", { mode: "json" })
    .$type<PostgresImportSourceInfo>()
    .notNull(),
  rowCounts: text("row_counts", { mode: "json" })
    .$type<Record<string, number>>()
    .notNull(),
});
