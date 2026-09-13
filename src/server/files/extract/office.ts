import "server-only";

import mammoth from "mammoth";
import { NodeHtmlMarkdown } from "node-html-markdown";
import * as XLSX from "xlsx";

import {
  DOCX_MEDIA_TYPE,
  PPTX_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  fileExtension,
  normalizeMediaType,
} from "@/lib/files/media-types";

import { extractPptx } from "./pptx";
import { errorMessage, truncateText } from "./truncate";
import type { ExtractionResult } from "./types";
import { isZipContainer } from "./zip";

/** The three ZIP/XML formats this extractor can open. */
type OfficeFormat = "docx" | "xlsx" | "pptx";

const OFFICE_FORMAT_BY_MEDIA_TYPE: Record<string, OfficeFormat> = {
  [DOCX_MEDIA_TYPE]: "docx",
  [XLSX_MEDIA_TYPE]: "xlsx",
  [PPTX_MEDIA_TYPE]: "pptx",
};

const OFFICE_FORMAT_BY_EXTENSION: Record<string, OfficeFormat> = {
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

/**
 * Which format to parse: the declared media type when it is one of the known
 * ones, otherwise the filename extension. `classifyFile` accepts a `.pptx` by
 * name when the browser reports an empty or generic type, so the extractor has
 * to agree — otherwise such an upload is accepted and then cached as `failed`.
 */
function officeFormat(
  mediaType: string,
  filename: string,
): OfficeFormat | null {
  return (
    OFFICE_FORMAT_BY_MEDIA_TYPE[normalizeMediaType(mediaType)] ??
    OFFICE_FORMAT_BY_EXTENSION[fileExtension(filename)] ??
    null
  );
}

const OFFICE_EXTRACTORS: Record<
  OfficeFormat,
  (buffer: Buffer) => ExtractionResult | Promise<ExtractionResult>
> = {
  docx: extractDocx,
  xlsx: extractXlsx,
  pptx: extractPptx,
};

export async function extractOffice(
  buffer: Buffer,
  mediaType: string,
  filename = "",
): Promise<ExtractionResult> {
  const format = officeFormat(mediaType, filename);
  if (format !== null) {
    return OFFICE_EXTRACTORS[format](buffer);
  }
  return {
    status: "failed",
    text: "",
    truncated: false,
    error: `unsupported office media type: ${normalizeMediaType(mediaType)}`,
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
  if (!isZipContainer(buffer)) {
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
