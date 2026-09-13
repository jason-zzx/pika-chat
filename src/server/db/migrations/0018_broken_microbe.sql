ALTER TABLE "app_settings" ADD COLUMN "file_storage_quota_bytes" bigint DEFAULT 5368709120;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "file_quota_bytes" bigint;