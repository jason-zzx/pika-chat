CREATE TYPE "public"."chat_generation_kind" AS ENUM('send', 'regenerate', 'edit');--> statement-breakpoint
CREATE TYPE "public"."chat_generation_status" AS ENUM('queued', 'running', 'stopping', 'completed', 'stopped', 'failed', 'interrupted');--> statement-breakpoint
CREATE TABLE "chat_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text,
	"request_hash" text,
	"request_expires_at" timestamp with time zone,
	"kind" "chat_generation_kind" NOT NULL,
	"status" "chat_generation_status" DEFAULT 'queued' NOT NULL,
	"topic_id" text,
	"assistant_message_id" text,
	"target_deleted_at" timestamp with time zone,
	"input" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "finish_reason" text;--> statement-breakpoint
ALTER TABLE "chat_generations" ADD CONSTRAINT "chat_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_generations" ADD CONSTRAINT "chat_generations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_generations_request_idx" ON "chat_generations" USING btree ("user_id","request_id") WHERE "chat_generations"."request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_generations_active_topic_idx" ON "chat_generations" USING btree ("topic_id") WHERE "chat_generations"."status" in ('queued', 'running', 'stopping');--> statement-breakpoint
CREATE INDEX "chat_generations_user_status_idx" ON "chat_generations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "chat_generations_status_finished_idx" ON "chat_generations" USING btree ("status","finished_at");