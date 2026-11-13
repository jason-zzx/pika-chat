CREATE TABLE "demo_usage_counters" (
	"subject" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "demo_usage_counters_pk" PRIMARY KEY("subject","day","kind")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;