-- Stable group position anchor. Backfill uses each group's earliest
-- SURVIVING version; groups whose original first version was already
-- deleted keep their (already shifted) position — the pre-anchor ordering
-- information is unrecoverable.
ALTER TABLE "chat_messages" ADD COLUMN "group_created_at" timestamp with time zone;

UPDATE "chat_messages" cm
SET "group_created_at" = sub."group_created_at"
FROM (
  SELECT "group_id", MIN("created_at") AS "group_created_at"
  FROM "chat_messages"
  GROUP BY "group_id"
) sub
WHERE cm."group_id" = sub."group_id";

ALTER TABLE "chat_messages" ALTER COLUMN "group_created_at" SET NOT NULL;
ALTER TABLE "chat_messages" ALTER COLUMN "group_created_at" SET DEFAULT now();
