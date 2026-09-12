import { describe, expect, it } from "vitest";

import { MAX_EXTRACTED_CHARS } from "@/lib/files/constants";
import {
  buildBrokenPdf,
  buildEncryptedPdf,
  buildScannedPdf,
  buildTextPdf,
} from "@test/fixtures/pdf";

import { extractPdf } from "./pdf";

describe("extractPdf", () => {
  it("extracts the text layer", async () => {
    const result = await extractPdf(buildTextPdf("Hello PDF layer"));
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("Hello PDF layer");
  });

  it("truncates a long document and flags it", async () => {
    const result = await extractPdf(buildTextPdf("A".repeat(MAX_EXTRACTED_CHARS + 5_000)));
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
  });

  it("reports a page without a text layer as empty (scanned document)", async () => {
    const result = await extractPdf(buildScannedPdf());
    expect(result).toEqual({ status: "empty", text: "", truncated: false });
  });

  it("reports an encrypted document as failed", async () => {
    const result = await extractPdf(buildEncryptedPdf());
    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(result.error).toBeTruthy();
  });

  it("reports corrupt bytes as failed", async () => {
    const result = await extractPdf(buildBrokenPdf());
    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
  });
});
