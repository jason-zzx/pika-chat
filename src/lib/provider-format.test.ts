import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_API_FORMAT,
  isProviderApiFormat,
  PROVIDER_API_FORMATS,
  PROVIDER_FORMAT_DEFAULTS,
  requiresApiKey,
} from "@/lib/provider-format";

describe("provider formats", () => {
  it("treats openai-compatible as the default", () => {
    expect(DEFAULT_PROVIDER_API_FORMAT).toBe("openai-compatible");
    expect(PROVIDER_API_FORMATS).toContain(DEFAULT_PROVIDER_API_FORMAT);
  });

  it("defaults each format to its vendor's documented endpoint", () => {
    expect(PROVIDER_FORMAT_DEFAULTS["openai-compatible"].defaultBaseUrl).toBe(
      "https://api.openai.com/v1",
    );
    expect(PROVIDER_FORMAT_DEFAULTS.claude.defaultBaseUrl).toBe(
      "https://api.anthropic.com/v1",
    );
    expect(PROVIDER_FORMAT_DEFAULTS.google.defaultBaseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("only lets keyless endpoints use openai-compatible", () => {
    expect(requiresApiKey("openai-compatible")).toBe(false);
    expect(requiresApiKey("claude")).toBe(true);
    expect(requiresApiKey("google")).toBe(true);
  });

  it("recognizes only the known formats", () => {
    for (const format of PROVIDER_API_FORMATS) {
      expect(isProviderApiFormat(format)).toBe(true);
    }
    expect(isProviderApiFormat("gemini")).toBe(false);
    expect(isProviderApiFormat("")).toBe(false);
  });
});
