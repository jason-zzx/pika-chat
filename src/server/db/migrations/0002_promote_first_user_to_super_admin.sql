-- Custom SQL migration file, put your code below! --
UPDATE "users"
SET "role" = 'super_admin',
    "updated_at" = now()
WHERE "id" = (
  SELECT "id"
  FROM "users"
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "users" WHERE "role" = 'super_admin'
);
