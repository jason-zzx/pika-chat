import { bigint, boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Seeded instance row. Auth-users owns later columns and the read/write path. */
export const APP_SETTINGS_ROW_ID = "0193e1c0-0000-7000-8000-000000000001";

/**
 * Global default per-user attachment storage quota (5 GiB). The column default
 * is what an existing deployment inherits on migration; an admin can clear it
 * to NULL to mean unlimited.
 */
export const DEFAULT_FILE_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  allowRegistration: boolean("allow_registration").notNull().default(false),
  fileStorageQuotaBytes: bigint("file_storage_quota_bytes", {
    mode: "number",
  }).default(DEFAULT_FILE_STORAGE_QUOTA_BYTES),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
