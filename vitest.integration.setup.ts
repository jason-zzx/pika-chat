import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Vars may already be in the environment.
  }

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is required for integration tests; copy .env.example to .env",
    );
  }

  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: "./src/server/db/migrations",
    });
  } finally {
    await client.end();
  }
}
