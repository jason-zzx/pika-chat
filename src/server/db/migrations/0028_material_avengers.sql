ALTER TABLE "chat_messages" ADD COLUMN "usage" jsonb;--> statement-breakpoint
UPDATE "chat_messages" SET "usage" = jsonb_build_object('totalTokens', "total_tokens") WHERE "total_tokens" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" DROP COLUMN "total_tokens";