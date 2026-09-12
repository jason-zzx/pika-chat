import { formatBytes } from "./format";

/** Largest single attachment accepted by the upload endpoint (20 MiB). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Largest number of attachments allowed on one chat message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/**
 * Human-readable form of {@link MAX_FILE_BYTES} used as an ICU param in
 * `Errors.file.tooLarge`, so the copy cannot drift from the enforced limit.
 */
export const MAX_FILE_SIZE_LABEL = formatBytes(MAX_FILE_BYTES);

/** Upper bound on extracted text injected into a model prompt. */
export const MAX_EXTRACTED_CHARS = 100_000;
