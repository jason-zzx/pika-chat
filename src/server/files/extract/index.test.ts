import { describe, expect, it } from "vitest";

import { buildDocx } from "@test/fixtures/docx";
import { buildEpub } from "@test/fixtures/epub";
import { buildTextPdf } from "@test/fixtures/pdf";
import { buildPptx } from "@test/fixtures/pptx";
import { DOCX_MEDIA_TYPE, PPTX_MEDIA_TYPE } from "@/lib/files/media-types";

import { extractDocument, sanitizeExtractedText } from "./index";

describe("extractDocument", () => {
  it("routes PDFs to the PDF extractor", async () => {
    const result = await extractDocument(
      buildTextPdf("routed pdf"),
      "application/pdf",
      "report.pdf",
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("routed pdf");
  });

  it("routes docx to the office extractor", async () => {
    const result = await extractDocument(
      buildDocx(["routed docx"]),
      DOCX_MEDIA_TYPE,
      "notes.docx",
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("routed docx");
  });

  it("routes pptx to the office extractor", async () => {
    const result = await extractDocument(
      buildPptx([{ body: ["routed pptx"], notes: ["routed notes"] }]),
      PPTX_MEDIA_TYPE,
      "deck.pptx",
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("## Slide 1");
    expect(result.text).toContain("routed pptx");
    expect(result.text).toContain("routed notes");
  });

  it("routes epub to the ebook extractor", async () => {
    const result = await extractDocument(
      buildEpub([{ id: "c1", body: "<p>routed epub</p>" }]),
      "application/epub+zip",
      "book.epub",
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("routed epub");
  });

  it("routes a pptx the browser typed generically by its extension", async () => {
    // `classifyFile` accepts `.pptx` by name because browsers so often report
    // an empty or octet-stream type for it; the extractor has to agree or the
    // upload is accepted and then cached as `failed` (→ `file.unreadable`).
    for (const mediaType of ["", "application/octet-stream"]) {
      const result = await extractDocument(
        buildPptx([{ body: ["fallback pptx"] }]),
        mediaType,
        "deck.pptx",
      );
      expect(result.status).toBe("ok");
      expect(result.text).toContain("fallback pptx");
    }
  });

  it("routes text extensions to the plain-text extractor", async () => {
    const result = await extractDocument(
      Buffer.from("routed text"),
      "application/octet-stream",
      "notes.md",
    );
    expect(result.status).toBe("ok");
    expect(result.text).toBe("routed text");
  });

  it("fails cleanly for an unsupported media type", async () => {
    const result = await extractDocument(
      Buffer.from("PK"),
      "application/zip",
      "archive.zip",
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("unsupported media type");
  });

  it("throws when handed an image (images are never extracted)", async () => {
    await expect(
      extractDocument(Buffer.from("png"), "image/png", "photo.png"),
    ).rejects.toThrow(/does not handle image/);
  });

  it("strips NUL and control characters from extractor output", async () => {
    // pdf.js emits NUL bytes for some embedded fonts (math glyphs); Postgres
    // `text` columns reject 0x00, so the dispatcher must clean every
    // extractor's output before it reaches the extraction-cache update.
    const result = await extractDocument(
      Buffer.from("alpha\x00beta\x01\x08gamma\x0B\x0C\x0E\x1F\x7Fdelta"),
      "text/plain",
      "controls.txt",
    );
    expect(result.status).toBe("ok");
    expect(result.text).toBe("alphabetagammadelta");
  });

  it("strips control characters from pptx and epub output", async () => {
    // DEL is legal XML but illegal in a Postgres `text` column's encoding —
    // same regression guard as the plain-text case above, for the new formats.
    const pptx = await extractDocument(
      buildPptx([{ body: ["slide\x7Ftext"] }]),
      PPTX_MEDIA_TYPE,
      "deck.pptx",
    );
    expect(pptx.status).toBe("ok");
    expect(pptx.text).toBe("## Slide 1\n\nslidetext");

    const epub = await extractDocument(
      buildEpub([{ id: "c1", body: "<p>chapter\x7Ftext</p>" }]),
      "application/epub+zip",
      "book.epub",
    );
    expect(epub.status).toBe("ok");
    expect(epub.text).toBe("chaptertext");
  });

  it("keeps tabs, newlines and carriage returns intact", async () => {
    const result = await extractDocument(
      Buffer.from("col1\tcol2\nline2\r\nline3"),
      "text/plain",
      "table.txt",
    );
    expect(result.status).toBe("ok");
    expect(result.text).toBe("col1\tcol2\nline2\r\nline3");
  });
});

describe("sanitizeExtractedText", () => {
  it("removes every disallowed control character", () => {
    const dirty = Array.from({ length: 0x20 }, (_, code) =>
      String.fromCharCode(code),
    ).join("") + "\x7F";
    expect(sanitizeExtractedText(dirty)).toBe("\t\n\r");
  });

  it("leaves ordinary text unchanged", () => {
    expect(sanitizeExtractedText("plain text 123 !\t\n")).toBe(
      "plain text 123 !\t\n",
    );
  });
});
