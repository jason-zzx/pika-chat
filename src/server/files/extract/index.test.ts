import { describe, expect, it } from "vitest";

import { buildDocx } from "@test/fixtures/docx";
import { buildTextPdf } from "@test/fixtures/pdf";
import { DOCX_MEDIA_TYPE } from "@/lib/files/media-types";

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
