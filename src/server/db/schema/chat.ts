import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
    reasoningMs: integer("reasoning_ms"),
    // Per-version translations keyed by BCP-47 target language code
    // ({ "zh-CN": "…" }); null until the first translation of the row.
    translations: jsonb("translations").$type<Record<string, string>>(),
    // Version group: rows sharing a groupId are versions of the same answer
    // slot; a standalone message forms a single-version group (groupId = id).
    groupId: text("group_id").notNull(),
    // Exactly one selected version per group (partial unique index below).
    isSelected: boolean("is_selected").notNull().default(true),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_topic_created_idx").on(table.topicId, table.createdAt),
    index("chat_messages_topic_group_idx").on(table.topicId, table.groupId),
    uniqueIndex("chat_messages_selected_version_idx")
      .on(table.groupId)
      .where(sql`${table.isSelected}`),
  ],
);
