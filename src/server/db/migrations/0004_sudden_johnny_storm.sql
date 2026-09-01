ALTER TABLE "provider_configs" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "provider_models" DROP COLUMN "display_name";--> statement-breakpoint
DROP TYPE "public"."provider_kind";