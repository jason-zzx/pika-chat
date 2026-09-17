import { describe, expect, it } from "vitest";

import { TRANSLATE_TARGET_LANGUAGE_CODES } from "@/lib/translate/languages";

import {
  chatMetadataSchema,
  translateMessageRequestSchema,
  translateMessageResponseSchema,
} from "./chat";

describe("chatMetadataSchema translations", () => {
  it("accepts a translations record keyed by language code", () => {
    const parsed = chatMetadataSchema.parse({
      translations: { "zh-CN": "你好", en: "hello" },
    });
    expect(parsed.translations).toEqual({ "zh-CN": "你好", en: "hello" });
  });

  it("keeps translations optional and rejects non-string values", () => {
    expect(chatMetadataSchema.parse({}).translations).toBeUndefined();
    expect(
      chatMetadataSchema.safeParse({ translations: { en: 42 } }).success,
    ).toBe(false);
  });
});

describe("translateMessageRequestSchema", () => {
  const base = {
    messageId: "m-1",
    targetLang: "en",
    providerConfigId: "cfg-1",
    modelId: "gpt-4o",
  };

  it("accepts every listed target language", () => {
    for (const code of TRANSLATE_TARGET_LANGUAGE_CODES) {
      expect(
        translateMessageRequestSchema.safeParse({ ...base, targetLang: code })
          .success,
      ).toBe(true);
    }
  });

  it("rejects an unlisted target language", () => {
    expect(
      translateMessageRequestSchema.safeParse({ ...base, targetLang: "pt" })
        .success,
    ).toBe(false);
  });

  it("requires the message and model identifiers", () => {
    expect(
      translateMessageRequestSchema.safeParse({ ...base, messageId: "" })
        .success,
    ).toBe(false);
    expect(
      translateMessageRequestSchema.safeParse({ ...base, modelId: "" }).success,
    ).toBe(false);
  });
});

describe("translateMessageResponseSchema", () => {
  it("parses the translation payload", () => {
    expect(
      translateMessageResponseSchema.parse({ translation: "Bonjour" }),
    ).toEqual({ translation: "Bonjour" });
  });
});
