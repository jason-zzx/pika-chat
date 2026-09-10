import { describe, expect, it } from "vitest";

import { isLocale, matchAcceptLanguage } from "./locales";

describe("isLocale", () => {
  it("accepts a supported locale", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isLocale("zh")).toBe(false);
    expect(isLocale("en-US")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});

describe("matchAcceptLanguage", () => {
  it("returns undefined without a usable header", () => {
    expect(matchAcceptLanguage(null)).toBeUndefined();
    expect(matchAcceptLanguage("")).toBeUndefined();
    expect(matchAcceptLanguage("   ")).toBeUndefined();
    expect(matchAcceptLanguage("fr-FR, de-DE;q=0.8")).toBeUndefined();
  });

  it("matches an exact tag", () => {
    expect(matchAcceptLanguage("zh-CN")).toBe("zh-CN");
    expect(matchAcceptLanguage("en")).toBe("en");
  });

  it("matches a base language by prefix", () => {
    expect(matchAcceptLanguage("zh")).toBe("zh-CN");
    expect(matchAcceptLanguage("zh-Hans")).toBe("zh-CN");
    expect(matchAcceptLanguage("zh-Hans-CN")).toBe("zh-CN");
    expect(matchAcceptLanguage("en-US")).toBe("en");
  });

  it("ignores case and surrounding whitespace", () => {
    expect(matchAcceptLanguage("ZH-cn")).toBe("zh-CN");
    expect(matchAcceptLanguage("  zh-CN , en;q=0.5 ")).toBe("zh-CN");
  });

  it("honours q-ordering", () => {
    expect(matchAcceptLanguage("en;q=0.4, zh-CN;q=0.9")).toBe("zh-CN");
    expect(matchAcceptLanguage("zh-CN;q=0.4, en;q=0.9")).toBe("en");
    // Malformed q-values are treated as unacceptable rather than crashing.
    expect(matchAcceptLanguage("zh-CN;q=nope, en;q=0.5")).toBe("en");
  });

  it("parses q-values with whitespace after the separator", () => {
    expect(matchAcceptLanguage("en; q=0.4, zh-CN; q=0.9")).toBe("zh-CN");
    expect(matchAcceptLanguage("zh-CN; q=0.9, en; q=0.4")).toBe("zh-CN");
  });

  it("keeps header order for equal q-values", () => {
    expect(matchAcceptLanguage("en, zh-CN")).toBe("en");
    expect(matchAcceptLanguage("zh-CN, en")).toBe("zh-CN");
  });

  it("skips q=0 entries", () => {
    expect(matchAcceptLanguage("zh-CN;q=0, en;q=0.7")).toBe("en");
  });

  it("falls through unsupported tags to a supported one", () => {
    expect(matchAcceptLanguage("fr-FR;q=0.9, zh-CN;q=0.8")).toBe("zh-CN");
    expect(matchAcceptLanguage("fr-FR;q=0.9, de;q=0.8, en;q=0.7")).toBe("en");
  });
});
