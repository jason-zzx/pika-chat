import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0) {
    return process.env.DATABASE_URL;
  }
  if (
    process.env.POSTGRES_HOST ||
    process.env.POSTGRES_USER ||
    process.env.POSTGRES_DB
  ) {
    const user = encodeURIComponent(process.env.POSTGRES_USER || "postgres");
    const pass =
      process.env.POSTGRES_PASSWORD !== undefined
        ? `:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}`
        : "";
    const host = process.env.POSTGRES_HOST || "localhost";
    const port = process.env.POSTGRES_PORT || "5432";
    const db = process.env.POSTGRES_DB || "pika_chat";
    return `postgres://${user}${pass}@${host}:${port}/${db}`;
  }
  return undefined;
}

async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required (or set POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)",
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

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
