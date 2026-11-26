import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { timestampMs, timestampMsDefaultNow } from "./columns";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  username: text("username").notNull().unique(),
  displayUsername: text("display_username"),
  role: text("role").notNull().default("user"),
  isAnonymous: integer("is_anonymous", { mode: "boolean" })
    .notNull()
    .default(false),
  // Per-user attachment storage quota override; NULL means follow the
  // instance-wide default (`app_settings.file_storage_quota_bytes`).
  fileQuotaBytes: integer("file_quota_bytes"),
  // Theme preference (value domains guarded by zod at the API boundary, same
  // style as `role`). `theme_mode`: light | dark | system; `theme_preset`:
  // default | paper | graphite | ocean | forest | rose | violet.
  themeMode: text("theme_mode").notNull().default("system"),
  themePreset: text("theme_preset").notNull().default("default"),
  // Per-user default model picks ({chat?, title?, compression?, translation?}
  // slots, each {providerConfigId, modelId}). NULL = no preferences; value
  // domain guarded by zod on read/write, same style as the theme columns.
  modelPreferences: text("model_preferences", { mode: "json" }),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestampMs("ban_expires"),
  createdAt: timestampMsDefaultNow("created_at"),
  updatedAt: timestampMsDefaultNow("updated_at"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestampMs("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestampMs("access_token_expires_at"),
    refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/**
 * better-auth `twoFactor` plugin state. Field set mirrors the plugin's own
 * declared schema (plus `id`) so the adapter needs no translation; `secret`
 * and `backup_codes` are stored encrypted by the plugin and are never read
 * back into a response.
 */
export const twoFactors = sqliteTable(
  "two_factors",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: integer("verified", { mode: "boolean" }).notNull().default(true),
    failedVerificationCount: integer("failed_verification_count")
      .notNull()
      .default(0),
    lockedUntil: timestampMs("locked_until"),
  },
  (table) => [
    index("two_factors_user_id_idx").on(table.userId),
    index("two_factors_secret_idx").on(table.secret),
  ],
);
