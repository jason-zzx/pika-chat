import "server-only";

import { z } from "zod";

const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (val === "" ? undefined : val), schema);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  CREDENTIAL_ENCRYPTION_SECRET: z.string().min(32),
  BETTER_AUTH_SECRET: z.string().min(32),
  // Public canonical URL of this instance.
  APP_URL: emptyToUndefined(z.url().optional()),
  // Additional trusted origins for Better Auth CORS / CSRF checks (comma-separated).
  // e.g. "http://localhost:3000,http://192.168.1.100:3000"
  APP_TRUSTED_ORIGINS: emptyToUndefined(z.string().min(1).optional()),
  // Root directory for locally stored chat attachments. Defaults to
  // `.data/files` relative to the process working directory.
  FILE_STORAGE_DIR: z.string().min(1).optional(),
  // S3-compatible object storage for chat attachments. `S3_BUCKET` is the
  // switch: set it and the S3 backend is used, leave it unset and attachments
  // stay on local disk. `S3_ENDPOINT` covers MinIO/RustFS/R2 style endpoints;
  // unset means the official AWS endpoint. Never log these values.
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Largest single chat attachment the server accepts, in MiB. Optional:
  // unset means 20. Values outside 1–100 fail at boot rather than silently
  // clamping — a limit the operator did not choose is worse than a crash.
  FILE_UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(100).optional(),
  // Direct client↔S3 byte transfer, both directions: presigned POST uploads
  // and 302-redirect presigned GET downloads. "1" or "true" turns it on;
  // unset keeps the server-side relay. Requires S3_BUCKET — enforced in
  // instrumentation.ts.
  S3_DIRECT_ACCESS: z.enum(["1", "true"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Resolves the database connection string. If `DATABASE_URL` is omitted,
 * assembles one from discrete `POSTGRES_*` environment variables with proper
 * URL encoding for credentials.
 */
export function resolveDatabaseUrl(
  raw: Record<string, string | undefined> = process.env,
): string | undefined {
  if (raw.DATABASE_URL && raw.DATABASE_URL.length > 0) {
    return raw.DATABASE_URL;
  }
  if (raw.POSTGRES_HOST || raw.POSTGRES_USER || raw.POSTGRES_DB) {
    const user = encodeURIComponent(raw.POSTGRES_USER || "postgres");
    const pass =
      raw.POSTGRES_PASSWORD !== undefined
        ? `:${encodeURIComponent(raw.POSTGRES_PASSWORD)}`
        : "";
    const host = raw.POSTGRES_HOST || "localhost";
    const port = raw.POSTGRES_PORT || "5432";
    const db = raw.POSTGRES_DB || "pika_chat";
    return `postgres://${user}${pass}@${host}:${port}/${db}`;
  }
  return undefined;
}

/**
 * Resolves additional trusted origins from `APP_TRUSTED_ORIGINS`.
 * Accepts comma-separated URLs or wildcard patterns (e.g. "http://192.168.1.100:3000,https://*.example.com").
 * Returns an array of trimmed, non-empty origin strings without duplicates.
 */
export function resolveTrustedOrigins(
  raw: Record<string, string | undefined> = process.env,
): string[] {
  const source = raw.APP_TRUSTED_ORIGINS;
  if (!source || source.length === 0) {
    return [];
  }
  const origins = source
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return Array.from(new Set(origins));
}

export function getEnv(): Env {
  if (cached) {
    return cached;
  }

  const dbUrl = resolveDatabaseUrl(process.env);
  const parsed = envSchema.safeParse({
    ...process.env,
    ...(dbUrl ? { DATABASE_URL: dbUrl } : {}),
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }

  cached = parsed.data;
  return cached;
}
