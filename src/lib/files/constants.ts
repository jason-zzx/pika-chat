/**
 * Fallback single-attachment ceiling (20 MiB). The server enforces the
 * operator-configured `FILE_UPLOAD_MAX_MB`; the client only uses this when the
 * `GET /api/files/limits` fetch fails, so an unreachable config endpoint does
 * not disable attachment staging entirely.
 */
export const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Largest number of attachments allowed on one chat message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** Upper bound on extracted text injected into a model prompt. */
export const MAX_EXTRACTED_CHARS = 100_000;
