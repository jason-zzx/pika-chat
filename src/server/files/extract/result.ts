import "server-only";

import { errorMessage, truncateText } from "./truncate";
import type { ExtractionResult } from "./types";

/** A failed extraction with `error` for the log; never shown to users. */
export function extractionFailure(error: string): ExtractionResult {
  return { status: "failed", text: "", truncated: false, error };
}

/**
 * Shapes collected sections into the result every ZIP/XML extractor reports.
 *
 * Sections that parsed join into one document (truncated to the shared budget);
 * when nothing survived, an error recorded while parsing means the document is
 * unreadable (`failed`) and its absence means it simply carries no text
 * (`empty`) — the distinction the send path turns into `file.unreadable` versus
 * `file.noTextLayer`.
 */
export function extractionResult(
  sections: readonly string[],
  errors: readonly unknown[],
): ExtractionResult {
  if (sections.length === 0) {
    const first = errors[0];
    return first === undefined
      ? { status: "empty", text: "", truncated: false }
      : extractionFailure(errorMessage(first));
  }
  const { text, truncated } = truncateText(sections.join("\n\n"));
  return { status: "ok", text, truncated };
}
