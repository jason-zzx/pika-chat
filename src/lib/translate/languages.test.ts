import { describe, expect, it } from "vitest";

import {
  TRANSLATE_TARGET_LANGUAGE_CODES,
  TRANSLATE_TARGET_LANGUAGES,
  translateLanguageNativeName,
} from "./languages";

describe("TRANSLATE_TARGET_LANGUAGES", () => {
  it("lists exactly the eight PRD languages in order", () => {
    expect(TRANSLATE_TARGET_LANGUAGES.map((language) => language.code)).toEqual(
      ["zh-CN", "en", "ja", "ko", "fr", "de", "es", "ru"],
    );
  });

  it("has unique codes and a native name for every entry", () => {
    const codes = TRANSLATE_TARGET_LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const language of TRANSLATE_TARGET_LANGUAGES) {
      expect(language.nativeName.length).toBeGreaterThan(0);
    }
  });

  it("keeps the zod tuple in sync with the list", () => {
    expect(TRANSLATE_TARGET_LANGUAGE_CODES).toEqual(
      TRANSLATE_TARGET_LANGUAGES.map((language) => language.code),
    );
  });
});

describe("translateLanguageNativeName", () => {
  it("returns the native name for a known code", () => {
    expect(translateLanguageNativeName("zh-CN")).toBe("简体中文");
    expect(translateLanguageNativeName("en")).toBe("English");
  });

  it("falls back to the raw code for unknown values", () => {
    expect(translateLanguageNativeName("pt-BR")).toBe("pt-BR");
  });
});
