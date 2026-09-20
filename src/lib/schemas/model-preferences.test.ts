import { describe, expect, it } from "vitest";

import { parseModelPreferences } from "./model-preferences";

describe("parseModelPreferences", () => {
  it("parses a full preference set", () => {
    const pair = { providerConfigId: "cfg-1", modelId: "gpt-4o" };
    expect(
      parseModelPreferences({ chat: pair, translation: pair }),
    ).toEqual({ chat: pair, translation: pair });
  });

  it("treats null and missing slots as unset", () => {
    expect(parseModelPreferences({ chat: null })).toEqual({ chat: null });
    expect(parseModelPreferences(null)).toEqual({});
    expect(parseModelPreferences(undefined)).toEqual({});
  });

  it("degrades dirty data to empty preferences", () => {
    expect(parseModelPreferences("garbage")).toEqual({});
    expect(parseModelPreferences({ chat: { providerConfigId: 1 } })).toEqual(
      {},
    );
  });
});
