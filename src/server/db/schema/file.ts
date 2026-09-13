import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { timestamptz } from "./columns";

export const fileExtractionStatus = pgEnum("file_extraction_status", [
  "none",
  "ok",
  "empty",
  "failed",
]);

/**
 * One provider-side upload of this file, as returned by the AI SDK
 * `uploadFile()` for a given provider config. Regenerable cache: our own
 * stored bytes stay the source of truth, and every consumer treats a missing
 * or unusable record as "upload again" rather than as an error.
 */
export type ProviderFileReference = {
  /** SDK `ProviderReference`, e.g. `{ google: "files/abc" }`. */
  reference: Record<string, string>;
  /** ISO timestamp of the upload. */
  uploadedAt: string;
  /** ISO expiry, or `null` when the provider never expires files. */
  expiresAt: string | null;
};

export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    // Extraction cache: populated at upload time for text-bearing formats.
    extractedText: text("extracted_text"),
    extractionStatus: fileExtractionStatus("extraction_status")
      .notNull()
      .default("none"),
    extractionTruncated: boolean("extraction_truncated").notNull().default(false),
    // Provider Files API references, keyed by provider config id — the same
    // bytes uploaded to two accounts are two independent references, and
    // writing one must never drop the others.
    providerReferences: jsonb("provider_references")
      .$type<Record<string, ProviderFileReference>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    // Refreshed when the extraction cache is written after upload.
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("files_user_idx").on(table.userId)],
);

/**
 * Bounded retry queue for provider-side file deletions that failed transiently
 * (429 / 5xx / network). A row's local attachment is already gone; this is the
 * only remaining record of the provider file, so it is deliberately *not*
 * foreign-keyed to `provider_configs` — deleting a config must not silently
 * drop the queue entry, or the provider file becomes unreachable.
 *
 * Processed lazily at the tail of the orphan sweep (`processDeleteRetries`),
 * which the project already triggers on every upload; there is no background
 * timer infrastructure.
 */
export const providerFileDeleteRetries = pgTable("provider_file_delete_retries", {
  id: text("id").primaryKey(),
  providerConfigId: text("provider_config_id").notNull(),
  /** Provider-side file id, e.g. Anthropic's `file_…`. */
  providerFileId: text("provider_file_id").notNull(),
  /** Failed retries so far. 5 is the ceiling before the entry is abandoned. */
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestamptz("next_retry_at").notNull(),
  /** HTTP status of the most recent attempt; null when there was none. */
  lastStatus: integer("last_status"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});
