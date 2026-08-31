import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Seeded instance row. Auth-users owns later columns and the read/write path. */
export const APP_SETTINGS_ROW_ID = "0193e1c0-0000-7000-8000-000000000001";

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  allowRegistration: boolean("allow_registration").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
