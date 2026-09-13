import "server-only";

import { posix } from "node:path";

import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { NodeHtmlMarkdown } from "node-html-markdown";

import { extractionFailure, extractionResult } from "./result";
import { errorMessage } from "./truncate";
import type { ExtractionResult } from "./types";
import { isZipContainer } from "./zip";

const CONTAINER_PATH = "META-INF/container.xml";

async function entryText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  return entry ? entry.async("string") : null;
}

/**
 * Resolves a manifest href against the directory holding the OPF. Hrefs inside
 * an OPF are relative to the OPF itself — not to the archive root — and many
 * epubs keep both the OPF and its chapters in a subdirectory (`OEBPS/`).
 */
function resolveHref(opfDirectory: string, href: string): string {
  const withoutFragment = href.split("#")[0] ?? href;
  // OPF hrefs are URIs: producers percent-encode characters the ZIP entry
  // name carries verbatim (spaces above all), so the path has to be decoded
  // before it can name an archive entry. A lone "%" is not valid
  // percent-encoding; then the href names the entry as written.
  let path = withoutFragment;
  try {
    path = decodeURIComponent(withoutFragment);
  } catch {
    // keep the href as written
  }
  // posix.normalize resolves "." and ".." against the OPF directory. An empty
  // directory makes the input absolute, so climbing past the archive root
  // clamps there; a climb out of a real directory leaves a leading ".." that
  // no entry name can carry, and such a chapter reads as missing.
  const resolved = posix
    .normalize(`${opfDirectory}/${path}`)
    .replace(/^\/+/, "");
  return resolved.startsWith("..") ? "" : resolved;
}

/**
 * Drops the XML declaration and the doctype. `node-html-markdown` copies both
 * into its output verbatim, which would otherwise prefix every chapter with
 * markup the model has no use for (and make a text-free chapter look non-empty).
 */
function stripProlog(xhtml: string): string {
  return xhtml
    .replace(/^\s*<\?xml[^>]*\?>/i, "")
    .replace(/^\s*<!DOCTYPE[^>]*>/i, "");
}

/** `full-path` of the OPF that `META-INF/container.xml` points at. */
function opfPath(containerXml: string): string | null {
  const doc = new DOMParser().parseFromString(containerXml, "text/xml");
  const rootfiles = doc.getElementsByTagNameNS("*", "rootfile");
  for (let index = 0; index < rootfiles.length; index += 1) {
    const fullPath = rootfiles[index]?.getAttribute("full-path");
    if (fullPath) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Reading order of the book: the `<itemref idref>` sequence of the spine
 * mapped through the manifest onto chapter hrefs. Local-name matching keeps
 * this working whatever namespace prefixes the producer used.
 */
function spineHrefs(opfXml: string): string[] {
  const doc = new DOMParser().parseFromString(opfXml, "text/xml");
  const hrefsById = new Map<string, string>();
  const items = doc.getElementsByTagNameNS("*", "item");
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id !== null && href !== null) {
      hrefsById.set(id, href);
    }
  }
  const hrefs: string[] = [];
  const itemrefs = doc.getElementsByTagNameNS("*", "itemref");
  for (let index = 0; index < itemrefs.length; index += 1) {
    const idref = itemrefs[index]?.getAttribute("idref");
    if (idref === null || idref === undefined) {
      continue;
    }
    const href = hrefsById.get(idref);
    if (href !== undefined) {
      hrefs.push(href);
    }
  }
  return hrefs;
}

/**
 * epub → Markdown, one section per spine chapter in reading order.
 *
 * A chapter that cannot be read is skipped so one broken file does not lose the
 * book; a missing `META-INF/container.xml`, a missing OPF or an empty spine
 * leaves nothing to read at all and is reported as `failed`.
 */
export async function extractEpub(buffer: Buffer): Promise<ExtractionResult> {
  if (!isZipContainer(buffer)) {
    return extractionFailure("not an epub (zip) container");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    return extractionFailure(errorMessage(error));
  }

  let hrefs: string[];
  let opfDirectory: string;
  try {
    const container = await entryText(zip, CONTAINER_PATH);
    if (container === null) {
      return extractionFailure(`missing ${CONTAINER_PATH}`);
    }
    const opf = opfPath(container);
    if (opf === null) {
      return extractionFailure(`${CONTAINER_PATH} declares no OPF rootfile`);
    }
    const opfXml = await entryText(zip, opf);
    if (opfXml === null) {
      return extractionFailure(`missing OPF package: ${opf}`);
    }
    hrefs = spineHrefs(opfXml);
    opfDirectory = opf.slice(0, Math.max(opf.lastIndexOf("/"), 0));
  } catch (error) {
    return extractionFailure(errorMessage(error));
  }

  if (hrefs.length === 0) {
    return extractionFailure("epub spine declares no chapters");
  }

  const chapters: string[] = [];
  const errors: unknown[] = [];
  for (const href of hrefs) {
    const path = resolveHref(opfDirectory, href);
    try {
      const xhtml = await entryText(zip, path);
      if (xhtml === null) {
        errors.push(new Error(`missing epub chapter: ${path}`));
        continue;
      }
      const markdown = NodeHtmlMarkdown.translate(stripProlog(xhtml)).trim();
      if (markdown.length > 0) {
        chapters.push(markdown);
      }
    } catch (error) {
      errors.push(error);
    }
  }

  return extractionResult(chapters, errors);
}
