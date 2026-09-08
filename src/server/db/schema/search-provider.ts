import { index, integer, pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { timestamptz } from "./columns";

export const searchProvider = pgEnum("search_provider", [
  "tavily",
  "exa",
  "firecrawl",
  "brave",
]);

/**
 * Per-user web search provider credentials. Private-only by design (no
 * visibility column — unlike provider_configs these are never shared).
 * `position` defines the fallback chain order and is compacted on write.
 */
export const searchProviderSettings = pgTable(
  "search_provider_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: searchProvider("provider").notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    apiKeyLastFour: text("api_key_last_four").notNull(),
    baseUrl: text("base_url"),
    position: integer("position").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("search_provider_settings_user_provider_uidx").on(
      table.userId,
      table.provider,
    ),
    index("search_provider_settings_user_position_idx").on(
      table.userId,
      table.position,
    ),
  ],
);
