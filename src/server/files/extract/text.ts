import "server-only";

import { truncateText } from "./truncate";
import type { ExtractionResult } from "./types";

/**
 * Plain-text extraction. Decodes as UTF-8 leniently (invalid bytes become the
 * replacement character rather than throwing) and strips a leading BOM.
 */
export function extractPlainText(buffer: Buffer): ExtractionResult {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const text = decoded.replace(/^\uFEFF/, "");
  if (text.trim().length === 0) {
    return { status: "empty", text: "", truncated: false };
  }
  const truncated = truncateText(text);
  return { status: "ok", text: truncated.text, truncated: truncated.truncated };
}
