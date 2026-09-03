CREATE TYPE "public"."model_metadata_source" AS ENUM('catalog', 'default', 'user');--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "context_tokens" integer DEFAULT 256000 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "input_modalities" jsonb DEFAULT '["text"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "output_modalities" jsonb DEFAULT '["text"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "reasoning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "reasoning_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "vendor_key" text;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "metadata_source" "model_metadata_source";--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;