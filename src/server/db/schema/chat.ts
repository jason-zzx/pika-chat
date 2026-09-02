import { index, jsonb, pgEnum, pgTable, text } from "drizzle-orm/pg-core";

import { topics } from "./assistant";
import { timestamptz } from "./columns";
import { providerConfigs } from "./provider";

export const chatMessageRole = pgEnum("chat_message_role", [
  "user",
  "assistant",
]);

export const chatMessageOutcome = pgEnum("chat_message_outcome", [
  "completed",
  "stopped",
  "failed",
]);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    role: chatMessageRole("role").notNull(),
    parts: jsonb("parts").notNull(),
    outcome: chatMessageOutcome("outcome"),
    errorMessage: text("error_message"),
    providerConfigId: text("provider_config_id").references(
      () => providerConfigs.id,
      { onDelete: "set null" },
    ),
    modelId: text("model_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_topic_created_idx").on(table.topicId, table.createdAt),
  ],
);
