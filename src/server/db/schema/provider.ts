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

import { users } from "./auth";
import { timestamptz } from "./columns";

export const providerVisibility = pgEnum("provider_visibility", [
  "private",
  "shared",
]);

export const providerApiFormat = pgEnum("provider_api_format", [
  "openai-compatible",
  "claude",
  "google",
]);

export const modelMetadataSource = pgEnum("model_metadata_source", [
  "catalog",
  "default",
  "user",
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
    apiFormat: providerApiFormat("api_format")
      .notNull()
      .default("openai-compatible"),
    encryptedApiKey: text("encrypted_api_key"),
    apiKeyLastFour: text("api_key_last_four"),
    visibility: providerVisibility("visibility").notNull().default("private"),
    // Negative cache: set when the endpoint answered the Files API with a
    // permanent error (no such endpoint, unsupported file type). Cleared
    // whenever baseUrl / api key / apiFormat change.
    filesApiUnsupportedAt: timestamptz("files_api_unsupported_at"),
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
    contextTokens: integer("context_tokens").notNull().default(256000),
    outputTokens: integer("output_tokens").notNull().default(65536),
    inputModalities: jsonb("input_modalities")
      .$type<string[]>()
      .notNull()
      .default(sql`'["text"]'::jsonb`),
    outputModalities: jsonb("output_modalities")
      .$type<string[]>()
      .notNull()
      .default(sql`'["text"]'::jsonb`),
    reasoning: boolean("reasoning").notNull().default(false),
    reasoningOptions: jsonb("reasoning_options")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    vendorKey: text("vendor_key"),
    metadataSource: modelMetadataSource("metadata_source"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_models_config_model_uidx").on(
      table.providerConfigId,
      table.modelId,
    ),
  ],
);
