CREATE TYPE "public"."provider_kind" AS ENUM('openai_compatible');--> statement-breakpoint
CREATE TYPE "public"."provider_visibility" AS ENUM('private', 'shared');--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" "provider_kind" DEFAULT 'openai_compatible' NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_api_key" text,
	"api_key_last_four" text,
	"visibility" "provider_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_config_id" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_models" ADD CONSTRAINT "provider_models_provider_config_id_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."provider_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_configs_owner_name_uidx" ON "provider_configs" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "provider_configs_visibility_idx" ON "provider_configs" USING btree ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_models_config_model_uidx" ON "provider_models" USING btree ("provider_config_id","model_id");