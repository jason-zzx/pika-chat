import "server-only";

import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

import { extractionFailure, extractionResult } from "./result";
import { errorMessage } from "./truncate";
import type { ExtractionResult } from "./types";
import { isZipContainer } from "./zip";

const SLIDE_PREFIX = "ppt/slides/slide";
const NOTES_PREFIX = "ppt/notesSlides/notesSlide";

interface SlidePart {
  page: number;
  entry: JSZip.JSZipObject;
}

/** `ppt/slides/slide12.xml` → 12; null for any other archive entry. */
function pageNumber(name: string, prefix: string): number | null {
  if (!name.startsWith(prefix)) {
    return null;
  }
  const digits = /^(\d+)\.xml$/.exec(name.slice(prefix.length))?.[1];
  return digits === undefined ? null : Number(digits);
}

/**
 * Slide (or notes) parts of one directory, ordered by page number. The archive
 * order is not trustworthy and a lexicographic sort would put `slide10.xml`
 * before `slide2.xml`.
 */
function collectParts(zip: JSZip, prefix: string): SlidePart[] {
  const parts: SlidePart[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue;
    }
    const page = pageNumber(name, prefix);
    if (page !== null) {
      parts.push({ page, entry });
    }
  }
  return parts.sort((left, right) => left.page - right.page);
}

/**
 * Text of one slide or notes part: the `<a:t>` runs of every `<a:p>` paragraph,
 * joined per paragraph. Matching on local names keeps the parse independent of
 * the namespace prefixes real producers choose.
 */
function partText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const paragraphs = doc.getElementsByTagNameNS("*", "p");
  const lines: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (!paragraph) {
      continue;
    }
    const runs = paragraph.getElementsByTagNameNS("*", "t");
    const pieces: string[] = [];
    for (let run = 0; run < runs.length; run += 1) {
      const text = runs[run]?.textContent;
      if (text) {
        pieces.push(text);
      }
    }
    const line = pieces.join("").trim();
    if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}

/**
 * pptx → per-slide Markdown with speaker notes. Slides are emitted in page
 * order as `## Slide N` sections; when `ppt/notesSlides/notesSlideN.xml`
 * carries text it is appended as a `Notes:` subsection of the matching page.
 *
 * A part that fails to parse is skipped so one damaged slide does not lose the
 * deck; when nothing survives the failure is reported (`failed`) instead of
 * masquerading as a text-free document.
 */
export async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  if (!isZipContainer(buffer)) {
    return extractionFailure("not a pptx (zip) container");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    return extractionFailure(errorMessage(error));
  }

  const errors: unknown[] = [];
  const notes = new Map<number, string>();
  for (const part of collectParts(zip, NOTES_PREFIX)) {
    try {
      const text = partText(await part.entry.async("string"));
      if (text.length > 0) {
        notes.set(part.page, text);
      }
    } catch (error) {
      errors.push(error);
    }
  }

  const sections: string[] = [];
  for (const part of collectParts(zip, SLIDE_PREFIX)) {
    try {
      const body = partText(await part.entry.async("string"));
      const note = notes.get(part.page) ?? "";
      if (body.length === 0 && note.length === 0) {
        continue;
      }
      const blocks = [`## Slide ${part.page}`];
      if (body.length > 0) {
        blocks.push(body);
      }
      if (note.length > 0) {
        blocks.push(`Notes:\n${note}`);
      }
      sections.push(blocks.join("\n\n"));
    } catch (error) {
      errors.push(error);
    }
  }

  return extractionResult(sections, errors);
}
