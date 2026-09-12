import "server-only";

import { classifyFile, normalizeMediaType } from "@/lib/files/media-types";

import { extractOffice } from "./office";
import { extractPdf } from "./pdf";
import { extractPlainText } from "./text";
import type { ExtractionResult } from "./types";

export type { ExtractionResult, ExtractionStatus } from "./types";

// C0 control characters (except \t \n \r) plus DEL. Postgres `text` columns
// reject NUL outright, and pdf.js emits NULs for some embedded fonts (math
// glyphs), so persisting raw extractor output can fail the extraction-cache
// update with `invalid byte sequence for encoding "UTF8": 0x00`.
const DISALLOWED_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Strips characters Postgres cannot store from extracted text. Applied once
 * at the dispatcher so every extractor's output — including plain-text files,
 * which can carry NULs too — is safe to persist. Tab, LF and CR survive.
 */
export function sanitizeExtractedText(text: string): string {
  return text.replace(DISALLOWED_CONTROL_CHARS, "");
}

/**
 * Dispatches a document to the extractor for its media type.
 *
 * Images are intentionally not handled: they are sent to vision models
 * natively or rejected, never extracted. Passing one is a programming error.
 * Unsupported formats return `failed` rather than throwing so an unguarded
 * caller degrades to a user-visible "unreadable" error.
 */
export async function extractDocument(
  buffer: Buffer,
  mediaType: string,
  filename = "",
): Promise<ExtractionResult> {
  const normalized = normalizeMediaType(mediaType);
  const category = classifyFile({ mediaType: normalized, filename });

  let result: ExtractionResult;
  switch (category) {
    case "pdf":
      result = await extractPdf(buffer);
      break;
    case "office":
      result = await extractOffice(buffer, normalized);
      break;
    case "text":
      result = extractPlainText(buffer);
      break;
    case "image":
      throw new Error("extractDocument does not handle image attachments");
    default:
      return {
        status: "failed",
        text: "",
        truncated: false,
        error: `unsupported media type: ${normalized}`,
      };
  }
  return { ...result, text: sanitizeExtractedText(result.text) };
}
