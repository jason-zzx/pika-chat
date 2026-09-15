ALTER TABLE "users" ADD COLUMN "theme_mode" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme_preset" text DEFAULT 'default' NOT NULL;