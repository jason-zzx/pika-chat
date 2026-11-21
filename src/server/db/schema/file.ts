import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { chatMessages } from "./chat";
import { timestampMs, timestampMsDefaultNow } from "./columns";

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

export const files = sqliteTable(
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
    extractionStatus: text("extraction_status", {
      enum: ["none", "ok", "empty", "failed"],
    })
      .notNull()
      .default("none"),
    extractionTruncated: integer("extraction_truncated", { mode: "boolean" })
      .notNull()
      .default(false),
    // Provider Files API references, keyed by provider config id — the same
    // bytes uploaded to two accounts are two independent references, and
    // writing one must never drop the others.
    providerReferences: text("provider_references", { mode: "json" })
      .$type<Record<string, ProviderFileReference>>()
      .notNull()
      .default({}),
    createdAt: timestampMsDefaultNow("created_at"),
    // Refreshed when the extraction cache is written after upload.
    updatedAt: timestampMsDefaultNow("updated_at"),
  },
  (table) => [index("files_user_idx").on(table.userId)],
);

/**
 * Indexed attachment references maintained by SQLite triggers on
 * `chat_messages` (`AFTER INSERT` / `AFTER UPDATE OF parts`), plus FK cascade
 * on message delete. No FK to `files` — a reference is a `/api/files/<id>` URL
 * in `parts`.
 */
export const messageFileRefs = sqliteTable(
  "message_file_refs",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.messageId, table.fileId],
      name: "message_file_refs_pk",
    }),
    index("message_file_refs_file_idx").on(table.fileId),
  ],
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
export const providerFileDeleteRetries = sqliteTable("provider_file_delete_retries", {
  id: text("id").primaryKey(),
  providerConfigId: text("provider_config_id").notNull(),
  /** Provider-side file id, e.g. Anthropic's `file_…`. */
  providerFileId: text("provider_file_id").notNull(),
  /** Failed retries so far. 5 is the ceiling before the entry is abandoned. */
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestampMs("next_retry_at").notNull(),
  /** HTTP status of the most recent attempt; null when there was none. */
  lastStatus: integer("last_status"),
  createdAt: timestampMsDefaultNow("created_at"),
});
