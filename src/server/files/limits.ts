import "server-only";

import { BYTES_PER_MB, DEFAULT_MAX_FILE_BYTES } from "@/lib/files/constants";
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
  return maxMb === undefined ? DEFAULT_MAX_FILE_BYTES : maxMb * BYTES_PER_MB;
}

/**
 * True when direct client↔S3 byte transfer (presigned POST uploads, 302
 * presigned GET downloads) is switched on. `register()` refuses to boot the
 * flag without S3_BUCKET, so in a running server the flag alone is the truth.
 */
export function isS3DirectAccessEnabled(): boolean {
  return getEnv().S3_DIRECT_ACCESS !== undefined;
}
