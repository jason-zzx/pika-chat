import "server-only";

import { DEFAULT_MAX_FILE_BYTES } from "@/lib/files/constants";
import { getEnv } from "@/server/env";

/**
 * Largest single attachment the server accepts, derived from
 * `FILE_UPLOAD_MAX_MB` (MiB). Unset means {@link DEFAULT_MAX_FILE_BYTES}.
 * Read per call rather than frozen at module load so the configured limit is
 * the single source of truth for both the upload endpoints and the limits
 * endpoint the composer consults.
 */
export function maxFileBytes(): number {
  const maxMb = getEnv().FILE_UPLOAD_MAX_MB;
  return maxMb === undefined ? DEFAULT_MAX_FILE_BYTES : maxMb * 1024 * 1024;
}

/**
 * True when direct client↔S3 byte transfer (presigned POST uploads, 302
 * presigned GET downloads) is switched on *and* the storage backend can serve
 * it. `register()` refuses to boot a direct flag without S3, so in a running
 * server this reduces to the env switch; the extra S3 check keeps the
 * predicate honest if it is ever called outside that boot path.
 */
export function isS3DirectAccessEnabled(): boolean {
  const env = getEnv();
  return env.S3_DIRECT_ACCESS !== undefined && env.S3_BUCKET !== undefined;
}
