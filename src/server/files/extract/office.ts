import "server-only";

import mammoth from "mammoth";
import { NodeHtmlMarkdown } from "node-html-markdown";
import * as XLSX from "xlsx";

import {
  DOCX_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  normalizeMediaType,
} from "@/lib/files/media-types";

import { errorMessage, truncateText } from "./truncate";
import type { ExtractionResult } from "./types";

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export async function extractOffice(
  buffer: Buffer,
  mediaType: string,
): Promise<ExtractionResult> {
  const normalized = normalizeMediaType(mediaType);
  if (normalized === DOCX_MEDIA_TYPE) {
    return extractDocx(buffer);
  }
  if (normalized === XLSX_MEDIA_TYPE) {
    return extractXlsx(buffer);
  }
  return {
    status: "failed",
    text: "",
    truncated: false,
    error: `unsupported office media type: ${normalized}`,
  };
}

/**
 * docx → Markdown. Mammoth's HTML conversion preserves the document
 * structure (headings, lists, bold, and — crucially — tables) that
 * `extractRawText` flattens into empty-line-separated cell text; a
 * Markdown render keeps the table shape the model needs (PRD acceptance:
 * "docx / xlsx tables arrive as Markdown/CSV"). `node-html-markdown` is a
 * single dependency with built-in GFM table handling. Mammoth's own
 * `convertToMarkdown` is deprecated and untyped, so it is deliberately not
 * used.
 */
async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const { value } = await mammoth.convertToHtml({ buffer });
    if (value.trim().length === 0) {
      return { status: "empty", text: "", truncated: false };
    }
    const markdown = NodeHtmlMarkdown.translate(value).trim();
    if (markdown.length === 0) {
      return { status: "empty", text: "", truncated: false };
    }
    const { text, truncated } = truncateText(markdown);
    return { status: "ok", text, truncated };
  } catch (error) {
    return {
      status: "failed",
      text: "",
      truncated: false,
      error: errorMessage(error),
    };
  }
}

/**
 * Renders every sheet as a titled CSV block. CSV keeps the table shape the
 * model needs without pulling in a markdown table writer, and survives ragged
 * rows that a markdown table would mangle.
 */
function workbookToText(workbook: XLSX.WorkBook): string {
  const sections: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      continue;
    }
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (csv.length === 0) {
      continue;
    }
    sections.push(`## ${name}\n\n${csv}`);
  }
  return sections.join("\n\n");
}

function extractXlsx(buffer: Buffer): ExtractionResult {
  // SheetJS happily parses arbitrary bytes as a text/CSV sheet, so a corrupt
  // file would otherwise look like a successful extraction. Real .xlsx files
  // are ZIP containers; reject anything that isn't one.
  if (!buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) {
    return {
      status: "failed",
      text: "",
      truncated: false,
      error: "not an xlsx (zip) container",
    };
  }
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const joined = workbookToText(workbook);
    if (joined.length === 0) {
      return { status: "empty", text: "", truncated: false };
    }
    const { text, truncated } = truncateText(joined);
    return { status: "ok", text, truncated };
  } catch (error) {
    return {
      status: "failed",
      text: "",
      truncated: false,
      error: errorMessage(error),
    };
  }
}
