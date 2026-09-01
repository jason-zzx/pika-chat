import {
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { timestamptz } from "./columns";

export const providerVisibility = pgEnum("provider_visibility", [
  "private",
  "shared",
]);

export const providerConfigs = pgTable(
  "provider_configs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    encryptedApiKey: text("encrypted_api_key"),
    apiKeyLastFour: text("api_key_last_four"),
    visibility: providerVisibility("visibility").notNull().default("private"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_configs_owner_name_uidx").on(table.ownerId, table.name),
    index("provider_configs_visibility_idx").on(table.visibility),
  ],
);

export const providerModels = pgTable(
  "provider_models",
  {
    id: text("id").primaryKey(),
    providerConfigId: text("provider_config_id")
      .notNull()
      .references(() => providerConfigs.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_models_config_model_uidx").on(
      table.providerConfigId,
      table.modelId,
    ),
  ],
);
