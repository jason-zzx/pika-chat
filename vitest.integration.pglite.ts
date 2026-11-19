import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { getDb } from "@/server/db/client";

if (process.env.PGLITE_DATA_DIR) {
  await migrate(getDb() as unknown as PgliteDatabase, {
    migrationsFolder: "./src/server/db/migrations",
  });
}
