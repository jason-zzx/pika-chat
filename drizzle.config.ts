import { defineConfig } from "drizzle-kit";

const databasePath = process.env.DATABASE_PATH;
if (!databasePath) {
  throw new Error("DATABASE_PATH is required to run drizzle-kit");
}

export default defineConfig({
  schema: "./src/server/db/schema",
  out: "./src/server/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
