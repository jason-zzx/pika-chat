CREATE TYPE "public"."search_provider" AS ENUM('tavily', 'exa', 'firecrawl', 'brave');--> statement-breakpoint
CREATE TABLE "search_provider_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "search_provider" NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"api_key_last_four" text NOT NULL,
	"base_url" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_provider_settings" ADD CONSTRAINT "search_provider_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_provider_settings_user_provider_uidx" ON "search_provider_settings" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "search_provider_settings_user_position_idx" ON "search_provider_settings" USING btree ("user_id","position");