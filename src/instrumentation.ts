/**
 * Runs once when the Node.js server boots. Validates the environment and the
 * attachment-storage backend selection eagerly so a misconfiguration (a
 * missing DATABASE_URL, an S3_BUCKET without credentials) fails at startup
 * with a readable error instead of surfacing on the first request that
 * happens to touch the lazy singletons.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { getEnv } = await import("@/server/env");
  const { getFileStorage } = await import("@/server/files/storage");
  getEnv();
  getFileStorage();
}
