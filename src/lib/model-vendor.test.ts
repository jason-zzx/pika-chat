import { describe, expect, it } from "vitest";

import {
  formatContextTokens,
  isCatalogFirstPartyProvider,
  modelHasVision,
  resolvedVendorKey,
  vendorKeyFromCatalogProvider,
  vendorKeyFromModelId,
} from "./model-vendor";

describe("vendorKeyFromModelId", () => {
  it("maps common model ids to a developer vendor", () => {
    expect(vendorKeyFromModelId("gpt-4o")).toBe("openai");
    expect(vendorKeyFromModelId("openai/gpt-4o")).toBe("openai");
    expect(vendorKeyFromModelId("claude-3-5-sonnet")).toBe("anthropic");
    expect(vendorKeyFromModelId("gemini-2.0-flash")).toBe("google");
    expect(vendorKeyFromModelId("deepseek-r1")).toBe("deepseek");
    expect(vendorKeyFromModelId("Qwen/Qwen2.5-72B")).toBe("alibaba");
    expect(vendorKeyFromModelId("glm-4")).toBe("zhipuai");
    expect(vendorKeyFromModelId("moonshot-v1")).toBe("moonshotai");
    expect(vendorKeyFromModelId("kimi-k3")).toBe("moonshotai");
    expect(vendorKeyFromModelId("sensenova-6.8-flash-lite")).toBe("sensenova");
    expect(vendorKeyFromModelId("llama3.1")).toBe("meta");
    expect(vendorKeyFromModelId("mistral-large")).toBe("mistral");
    expect(vendorKeyFromModelId("grok-3")).toBe("xai");
  });

  it("returns null for unknown local ids", () => {
    expect(vendorKeyFromModelId("local-llama-custom")).toBe("meta");
    expect(vendorKeyFromModelId("my-finetune-7b")).toBeNull();
    expect(vendorKeyFromModelId("unknown-lab-model")).toBeNull();
  });
});

describe("resolvedVendorKey", () => {
  it("prefers a stored override", () => {
    expect(resolvedVendorKey("deepseek", "gpt-4o")).toBe("deepseek");
    expect(resolvedVendorKey(null, "gpt-4o")).toBe("openai");
  });

  it("ignores an unknown stored reseller key and uses the model id", () => {
    expect(resolvedVendorKey("cortecs", "gpt-4o")).toBe("openai");
  });
});

describe("vendorKeyFromCatalogProvider", () => {
  it("maps the zhipu family coding-plan providers to zhipuai", () => {
    expect(vendorKeyFromCatalogProvider("zhipuai-coding-plan", "gpt-4o")).toBe(
      "zhipuai",
    );
    expect(vendorKeyFromCatalogProvider("zai-coding-plan", "gpt-4o")).toBe(
      "zhipuai",
    );
    expect(isCatalogFirstPartyProvider("zhipuai-coding-plan")).toBe(true);
    expect(isCatalogFirstPartyProvider("zai-coding-plan")).toBe(true);
  });
});

describe("formatContextTokens", () => {
  it("renders millions as M", () => {
    expect(formatContextTokens(1_000_000)).toBe("1M");
    expect(formatContextTokens(1_048_576)).toBe("1M");
    expect(formatContextTokens(2_097_152)).toBe("2M");
  });

  it("hides the context label below one million tokens", () => {
    expect(formatContextTokens(999_999)).toBeNull();
    expect(formatContextTokens(256_000)).toBeNull();
    expect(formatContextTokens(200_000)).toBeNull();
    expect(formatContextTokens(0)).toBeNull();
    expect(formatContextTokens(-1_000_000)).toBeNull();
  });
});

describe("modelHasVision", () => {
  it("treats image input as vision", () => {
    expect(modelHasVision(["text"])).toBe(false);
    expect(modelHasVision(["text", "image"])).toBe(true);
  });
});
