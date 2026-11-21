import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { timestampMsDefaultNow } from "./columns";

/** Seeded instance row. Auth-users owns later columns and the read/write path. */
export const APP_SETTINGS_ROW_ID = "0193e1c0-0000-7000-8000-000000000001";

/**
 * Global default per-user attachment storage quota (5 GiB). The column default
 * is what an existing deployment inherits on migration; an admin can clear it
 * to NULL to mean unlimited.
 */
export const DEFAULT_FILE_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey(),
  allowRegistration: integer("allow_registration", { mode: "boolean" })
    .notNull()
    .default(false),
  fileStorageQuotaBytes: integer("file_storage_quota_bytes").default(
    DEFAULT_FILE_STORAGE_QUOTA_BYTES,
  ),
  createdAt: timestampMsDefaultNow("created_at"),
  updatedAt: timestampMsDefaultNow("updated_at"),
});
