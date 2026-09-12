import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import { errorMessage, truncateText } from "./truncate";
import type { ExtractionResult } from "./types";

/** Joins per-page text with a blank line, dropping pages with no text layer. */
function pagesToText(pages: readonly string[]): string {
  return pages
    .map((page) => page.trim())
    .filter((page) => page.length > 0)
    .join("\n\n");
}

/**
 * Per-page PDF text extraction. Returns `empty` for a PDF that parses but has
 * no text layer (a scanned document) and `failed` for encrypted or corrupt
 * files, so the caller can tell the two apart.
 */
export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  let pages: readonly string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: false });
    pages = result.text;
  } catch (error) {
    return {
      status: "failed",
      text: "",
      truncated: false,
      error: errorMessage(error),
    };
  }

  const joined = pagesToText(pages);
  if (joined.length === 0) {
    return { status: "empty", text: "", truncated: false };
  }
  const { text, truncated } = truncateText(joined);
  return { status: "ok", text, truncated };
}
