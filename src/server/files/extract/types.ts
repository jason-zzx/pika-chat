import "server-only";

/**
 * Outcome of extracting text from an uploaded document. `none` (the DB enum's
 * fourth value) is deliberately absent: images never reach the extractor, and
 * the service records `none` for them without calling this module.
 */
export type ExtractionStatus = "ok" | "empty" | "failed";

export interface ExtractionResult {
  /** `empty` = parsed fine but carried no text (scanned PDF, blank sheet). */
  status: ExtractionStatus;
  /** Extracted text, or `""` when none is available. */
  text: string;
  /** True when the raw extraction exceeded `MAX_EXTRACTED_CHARS`. */
  truncated: boolean;
  /** Failure detail for logs only; never shown to users. Set iff `failed`. */
  error?: string;
}
