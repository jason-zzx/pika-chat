import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { defineConfig } from "drizzle-kit";

const databasePath = process.env.DATABASE_PATH;
if (!databasePath) {
  throw new Error("DATABASE_PATH is required to run drizzle-kit");
}
// Same as the app's boot (src/server/db/client.ts): a fresh path works without
// creating its directory first.
if (databasePath !== ":memory:") {
  mkdirSync(dirname(databasePath), { recursive: true });
}

export default defineConfig({
  schema: "./src/server/db/schema",
  out: "./src/server/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
