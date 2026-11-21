import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { timestampMsDefaultNow } from "./columns";

export const searchProviders = ["tavily", "exa", "firecrawl", "brave"] as const;

/**
 * Per-user web search provider credentials. Private-only by design (no
 * visibility column — unlike provider_configs these are never shared).
 * `position` defines the fallback chain order and is compacted on write.
 */
export const searchProviderSettings = sqliteTable(
  "search_provider_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: searchProviders }).notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    apiKeyLastFour: text("api_key_last_four").notNull(),
    baseUrl: text("base_url"),
    position: integer("position").notNull(),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
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
