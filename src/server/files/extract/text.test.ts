import { describe, expect, it } from "vitest";

import { MAX_EXTRACTED_CHARS } from "@/lib/files/constants";

import { extractPlainText } from "./text";

describe("extractPlainText", () => {
  it("reads UTF-8 content", () => {
    const result = extractPlainText(Buffer.from("hello\nworld\n"));
    expect(result).toEqual({
      status: "ok",
      text: "hello\nworld\n",
      truncated: false,
    });
  });

  it("strips a leading BOM", () => {
    const result = extractPlainText(Buffer.from("\uFEFFname,age\n"));
    expect(result.text).toBe("name,age\n");
    expect(result.status).toBe("ok");
  });

  it("reports whitespace-only content as empty", () => {
    expect(extractPlainText(Buffer.from("   \n\t "))).toEqual({
      status: "empty",
      text: "",
      truncated: false,
    });
  });

  it("truncates beyond the budget and flags it", () => {
    const input = "a".repeat(MAX_EXTRACTED_CHARS + 500);
    const result = extractPlainText(Buffer.from(input));
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
  });

  it("keeps content exactly at the budget untruncated", () => {
    const input = "a".repeat(MAX_EXTRACTED_CHARS);
    const result = extractPlainText(Buffer.from(input));
    expect(result.truncated).toBe(false);
    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
  });

  it("decodes invalid UTF-8 leniently instead of failing", () => {
    const result = extractPlainText(Buffer.from([0x66, 0x6f, 0x80, 0x6f]));
    expect(result.status).toBe("ok");
    expect(result.text).toBe("fo\uFFFDo");
  });
});
