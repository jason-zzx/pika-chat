/**
 * Runs once when the Node.js server boots. Validates the environment and the
 * attachment-storage backend selection eagerly so a misconfiguration (a
 * missing DATABASE_URL, an S3_BUCKET without credentials) fails at startup
 * with a readable error instead of surfacing on the first request that
 * happens to touch the lazy singletons.
 *
 * It also starts the generation executor (chat task §5): the server — not the
 * browser request — owns chat generation, so the runner recovers turns a
 * previous process left running and then claims queued work. `next build`
 * never calls this, so a build schedules nothing.
 */
export async function register(): Promise<void> {
  // Keep Node imports inside the positive runtime branch. Webpack does not
  // prune imports after an early return when compiling Edge instrumentation.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/server/env");
    const { getFileStorage } = await import("@/server/files/storage");
    const env = getEnv();
    // Direct S3 access is an S3-only flow: the local disk backend has no
    // presigned URL to hand out. Silently falling back would make the same env
    // behave differently per deployment, so refuse to boot instead.
    if (env.S3_DIRECT_ACCESS !== undefined && !env.S3_BUCKET) {
      throw new Error(
        "S3_DIRECT_ACCESS is enabled but S3_BUCKET is not configured: direct S3 access requires S3-compatible storage",
      );
    }
    getFileStorage();

    const { startGenerationRunner } = await import(
      "@/server/ai/generation-runner"
    );
    await startGenerationRunner();
  }
}
