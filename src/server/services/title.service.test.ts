import { describe, expect, it } from "vitest";

import { DEFAULT_TOPIC_TITLE } from "@/lib/schemas/topic";

import {
  fallbackTitleFromMessage,
  sanitizeGeneratedTitle,
  TITLE_MAX_LENGTH,
} from "./title.service";

describe("sanitizeGeneratedTitle", () => {
  it("trims, strips quotes, and collapses whitespace", () => {
    expect(sanitizeGeneratedTitle('  "Hello\nworld"  ')).toBe("Hello world");
  });

  it("treats empty and over-long output as failure", () => {
    expect(sanitizeGeneratedTitle("   ")).toBeNull();
    expect(sanitizeGeneratedTitle("x".repeat(201))).toBeNull();
  });

  it("clamps a long but acceptable title", () => {
    const title = sanitizeGeneratedTitle("n".repeat(80));
    expect(title).toHaveLength(TITLE_MAX_LENGTH);
  });
});

describe("fallbackTitleFromMessage", () => {
  it("truncates the first user message", () => {
    const text = "a".repeat(TITLE_MAX_LENGTH + 10);
    const title = fallbackTitleFromMessage(text);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBe(TITLE_MAX_LENGTH + 1);
  });

  it("returns the default title for empty text", () => {
    expect(fallbackTitleFromMessage("   ")).toBe(DEFAULT_TOPIC_TITLE);
  });
});
