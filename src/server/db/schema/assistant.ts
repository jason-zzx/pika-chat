import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { timestamptz } from "./columns";
import { providerConfigs } from "./provider";

export const assistants = pgTable(
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
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("assistants_owner_name_uidx").on(table.ownerId, table.name),
  ],
);

export const topics = pgTable(
  "topics",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    isFavorite: boolean("is_favorite").notNull().default(false),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("topics_assistant_id_idx").on(table.assistantId)],
);

/** The `Topic` shape every service returns. Lives here, not in a service, so
 * assistant.service and topic.service can share it without an import cycle. */
export const topicColumns = {
  id: topics.id,
  title: topics.title,
  isFavorite: topics.isFavorite,
  createdAt: topics.createdAt,
  updatedAt: topics.updatedAt,
};
