CREATE TABLE "provider_file_delete_retries" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_config_id" text NOT NULL,
	"provider_file_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone NOT NULL,
	"last_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
