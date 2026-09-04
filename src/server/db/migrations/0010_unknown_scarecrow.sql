ALTER TABLE "chat_messages" ADD COLUMN "group_id" text;--> statement-breakpoint
-- Backfill: every existing row forms a single-version group keyed by its own id.
UPDATE "chat_messages" SET "group_id" = "id";--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "is_selected" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_messages_topic_group_idx" ON "chat_messages" USING btree ("topic_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_selected_version_idx" ON "chat_messages" USING btree ("group_id") WHERE "chat_messages"."is_selected";