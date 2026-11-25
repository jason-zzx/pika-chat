import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { timestampMsDefaultNow } from "./columns";
import { providerConfigs } from "./provider";

export const assistants = sqliteTable(
  "assistants",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    systemPrompt: text("system_prompt"),
    defaultProviderConfigId: text("default_provider_config_id").references(
      () => providerConfigs.id,
      { onDelete: "set null" },
    ),
    defaultModelId: text("default_model_id"),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
  },
  (table) => [
    uniqueIndex("assistants_owner_name_uidx").on(table.ownerId, table.name),
  ],
);

export const topics = sqliteTable(
  "topics",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    isFavorite: integer("is_favorite", { mode: "boolean" })
      .notNull()
      .default(false),
    // Temporary chat: set only at creation, hidden from every list and
    // search, deleted when the user leaves it or after 24h idle.
    temporary: integer("temporary", { mode: "boolean" })
      .notNull()
      .default(false),
    // Rolling history-compression state (会话历史压缩): the summary covers
    // every message up to and including summaryUpToMessageId. All nullable —
    // a topic without them behaves exactly as before.
    summaryText: text("summary_text"),
    summaryUpToMessageId: text("summary_up_to_message_id"),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
  },
  (table) => [
    index("topics_assistant_list_idx").on(
      table.assistantId,
      table.isFavorite,
      sql`updated_at desc`,
      sql`id desc`,
    ),
  ],
);

/** The `Topic` shape every service returns. Lives here, not in a service, so
 * assistant.service and topic.service can share it without an import cycle. */
export const topicColumns = {
  id: topics.id,
  title: topics.title,
  isFavorite: topics.isFavorite,
  temporary: topics.temporary,
  createdAt: topics.createdAt,
  updatedAt: topics.updatedAt,
};
