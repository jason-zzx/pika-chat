import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { buildDocx, buildDocxTable } from "@test/fixtures/docx";
import {
  DOCX_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
} from "@/lib/files/media-types";
import { MAX_EXTRACTED_CHARS } from "@/lib/files/constants";

import { extractOffice } from "./office";

type Cell = string | number;

function buildXlsx(sheets: Record<string, Cell[][]>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("extractOffice — docx", () => {
  it("extracts paragraph text", async () => {
    const result = await extractOffice(
      buildDocx(["Hello docx", "Second paragraph"]),
      DOCX_MEDIA_TYPE,
    );
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("Hello docx");
    expect(result.text).toContain("Second paragraph");
  });

  it("renders tables as Markdown so the structure survives", async () => {
    const result = await extractOffice(
      buildDocxTable([
        ["name", "age"],
        ["Ada", "36"],
      ]),
      DOCX_MEDIA_TYPE,
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("| name | age |");
    // GFM separator row (dash widths are column-padded by the converter).
    expect(result.text).toMatch(/\|\s*-{3,}\s*\|\s*-{3,}\s*\|/);
    expect(result.text).toContain("Ada");
    expect(result.text).toContain("36");
  });

  it("reports a document with only blank paragraphs as empty", async () => {
    const result = await extractOffice(buildDocx([""]), DOCX_MEDIA_TYPE);
    expect(result.status).toBe("empty");
    expect(result.text).toBe("");
  });

  it("reports a corrupt docx as failed", async () => {
    const result = await extractOffice(
      Buffer.from("not a zip file at all"),
      DOCX_MEDIA_TYPE,
    );
    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(result.error).toBeTruthy();
  });
});

describe("extractOffice — xlsx", () => {
  it("renders each sheet as a titled CSV block", async () => {
    const result = await extractOffice(
      buildXlsx({
        People: [
          ["name", "age"],
          ["Ada", 36],
        ],
        Totals: [["sum"], [36]],
      }),
      XLSX_MEDIA_TYPE,
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("## People");
    expect(result.text).toContain("name,age");
    expect(result.text).toContain("Ada,36");
    expect(result.text).toContain("## Totals");
  });

  it("reports a workbook with no cells as empty", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Empty");
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;
    const result = await extractOffice(buffer, XLSX_MEDIA_TYPE);
    expect(result.status).toBe("empty");
  });

  it("truncates long workbooks and flags it", async () => {
    const rows = Array.from({ length: 4000 }, (_, index) => [
      `row-${index}`,
      "x".repeat(50),
    ]);
    const result = await extractOffice(buildXlsx({ Sheet1: rows }), XLSX_MEDIA_TYPE);
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
  });

  it("reports a corrupt xlsx as failed", async () => {
    const result = await extractOffice(
      Buffer.from("not a workbook"),
      XLSX_MEDIA_TYPE,
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
  });
});

describe("extractOffice — unsupported type", () => {
  it("fails cleanly for a non-office media type", async () => {
    const result = await extractOffice(
      Buffer.from("x"),
      "application/vnd.ms-excel",
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("unsupported office media type");
  });
});
