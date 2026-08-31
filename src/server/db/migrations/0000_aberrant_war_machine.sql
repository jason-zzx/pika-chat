CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"allow_registration" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO "app_settings" ("id", "allow_registration")
VALUES ('0193e1c0-0000-7000-8000-000000000001', false);
