import { boolean, index, integer, pgEnum, pgTable, text } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { timestamptz } from "./columns";

export const fileExtractionStatus = pgEnum("file_extraction_status", [
  "none",
  "ok",
  "empty",
  "failed",
]);

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
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    // Refreshed when the extraction cache is written after upload.
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("files_user_idx").on(table.userId)],
);
