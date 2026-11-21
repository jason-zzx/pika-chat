import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { timestampMs, timestampMsDefaultNow } from "./columns";

export const providerVisibilities = ["private", "shared"] as const;

export const providerApiFormats = [
  "openai-compatible",
  "claude",
  "google",
] as const;

export const modelMetadataSources = ["catalog", "default", "user"] as const;

export const providerConfigs = sqliteTable(
  "provider_configs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    apiFormat: text("api_format", { enum: providerApiFormats })
      .notNull()
      .default("openai-compatible"),
    encryptedApiKey: text("encrypted_api_key"),
    apiKeyLastFour: text("api_key_last_four"),
    visibility: text("visibility", { enum: providerVisibilities })
      .notNull()
      .default("private"),
    // Disabled configs keep their rows but vanish from resolveAvailableModels,
    // which also gates createChatModelHandle — so chat rejects them too.
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // Negative cache: set when the endpoint answered the Files API with a
    // permanent error (no such endpoint, unsupported file type). Cleared
    // whenever baseUrl / api key / apiFormat change.
    filesApiUnsupportedAt: timestampMs("files_api_unsupported_at"),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
  },
  (table) => [
    uniqueIndex("provider_configs_owner_name_uidx").on(table.ownerId, table.name),
    index("provider_configs_visibility_idx").on(table.visibility),
  ],
);

export const providerModels = sqliteTable(
  "provider_models",
  {
    id: text("id").primaryKey(),
    providerConfigId: text("provider_config_id")
      .notNull()
      .references(() => providerConfigs.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    contextTokens: integer("context_tokens").notNull().default(256000),
    outputTokens: integer("output_tokens").notNull().default(65536),
    inputModalities: text("input_modalities", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(["text"]),
    outputModalities: text("output_modalities", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(["text"]),
    reasoning: integer("reasoning", { mode: "boolean" })
      .notNull()
      .default(false),
    reasoningOptions: text("reasoning_options", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    vendorKey: text("vendor_key"),
    metadataSource: text("metadata_source", { enum: modelMetadataSources }),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
  },
  (table) => [
    uniqueIndex("provider_models_config_model_uidx").on(
      table.providerConfigId,
      table.modelId,
    ),
  ],
);
