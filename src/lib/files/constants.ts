/**
 * Fallback single-attachment ceiling (20 MiB). The server enforces the
 * operator-configured `FILE_UPLOAD_MAX_MB`; the client only uses this when the
 * `GET /api/files/limits` fetch fails, so an unreachable config endpoint does
 * not disable attachment staging entirely.
 */
export const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Largest number of attachments allowed on one chat message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/**
 * Bytes in one mebibyte. The storage quota is configured and displayed in MB,
 * so the services convert at this boundary and keep bytes in the database.
 */
export const BYTES_PER_MB = 1024 * 1024;

/**
 * Largest quota an admin input may carry, in MB. Derived from the
 * safe-integer ceiling so a value that survives zod can still be multiplied
 * into bytes and stored in the bigint column without precision loss; anything
 * larger is a 400 at the boundary instead of a database overflow 500.
 */
export const MAX_QUOTA_MB = Math.floor(Number.MAX_SAFE_INTEGER / BYTES_PER_MB);

/** Upper bound on extracted text injected into a model prompt. */
export const MAX_EXTRACTED_CHARS = 100_000;
