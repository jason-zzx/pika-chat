import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_CAPABILITY,
  formatRatioBound,
  freeformRules,
  imageCapabilityFor,
  validateFreeformSize,
} from "./image-capabilities";

const GPT_IMAGE_2_CONSTRAINTS = {
  divisibleBy: 16,
  ratioMin: 1 / 3,
  ratioMax: 3,
  maxSide: 3840,
};

describe("imageCapabilityFor", () => {
  it("matches the gpt-image family in three tiers, longest prefix first", () => {
    // 2.5 ids also contain "gpt-image-2", so rule order decides.
    for (const id of [
      "gpt-image-2.5-flare",
      "openai/gpt-image-2.5-sunburst-2026-09-08",
    ]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("freeform");
      expect(cap.sizes).toContain("2160x3840");
      expect(cap.qualities).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "auto",
      ]);
      expect(cap.nMax).toBe(10);
      expect(cap.freeform).toEqual(GPT_IMAGE_2_CONSTRAINTS);
    }

    for (const id of ["gpt-image-2", "gpt-image-2-2026-04-21"]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("freeform");
      expect(cap.sizes).toContain("2048x1152");
      expect(cap.sizes).not.toContain("2160x3840");
      expect(cap.qualities).toEqual(["low", "medium", "high", "auto"]);
      expect(cap.nMax).toBe(10);
      expect(cap.freeform).toEqual(GPT_IMAGE_2_CONSTRAINTS);
    }

    for (const id of ["gpt-image-1", "gpt-image-1.5", "gpt-image-1-mini"]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("openai-size");
      expect(cap.sizes).toEqual(["1024x1024", "1536x1024", "1024x1536"]);
      expect(cap.qualities).toEqual(["low", "medium", "high", "auto"]);
      expect(cap.nMax).toBe(10);
      expect(cap.freeform).toBeUndefined();
    }
  });

  it("matches dall-e-3 and dall-e-2 distinctly", () => {
    const d3 = imageCapabilityFor("dall-e-3");
    expect(d3.sizes).toContain("1792x1024");
    expect(d3.nMax).toBe(1);
    expect(d3.qualities).toEqual(["standard", "hd"]);

    const d2 = imageCapabilityFor("dall-e-2");
    expect(d2.sizes).toEqual(["256x256", "512x512", "1024x1024"]);
    expect(d2.nMax).toBe(10);
    expect(d2.qualities).toBeUndefined();
  });

  it("gives gemini-3.1-flash-image and gemini-3-pro-image 15 ratios and 1K-4K tiers", () => {
    for (const id of [
      "gemini-3.1-flash-image",
      "google/gemini-3.1-flash-image",
      "gemini-3-pro-image",
      "google/Gemini-3-Pro-Image",
    ]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("aspect-ratio");
      expect(cap.sizes).toHaveLength(15);
      expect(cap.sizes).toContain("16:9");
      expect(cap.sizes).toContain("1:8");
      expect(cap.sizes).toContain("9:21");
      expect(cap.imageSizes).toEqual(["1K", "2K", "4K"]);
      expect(cap.nMax).toBe(4);
    }
  });

  it("restricts other gemini image models to 10 ratios and 1K only", () => {
    for (const id of [
      "gemini-2.5-flash-image",
      "google/gemini-2.5-flash-image",
      "gemini-3.1-flash-lite-image",
      "nanobanana",
    ]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("aspect-ratio");
      expect(cap.sizes).toHaveLength(10);
      expect(cap.sizes).toContain("16:9");
      expect(cap.sizes).not.toContain("1:8");
      expect(cap.imageSizes).toEqual(["1K"]);
      expect(cap.nMax).toBe(4);
    }
  });

  it("splits the seedream family by version, matching dash and dot forms", () => {
    // 5-0-pro: single image, no pixel bounds.
    for (const id of ["doubao-seedream-5-0-pro-260628", "seedream-5.0-pro"]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("freeform");
      expect(cap.nMax).toBe(1);
      expect(cap.freeform).toBeUndefined();
    }

    // 5-0-lite / 4-5: 1920x1920-class pixel floor.
    for (const id of [
      "doubao-seedream-4-5-251128",
      "doubao-seedream-4-5",
      "seedream-4.5",
      "seedream-5-0-lite",
      "seedream-5.0-lite",
    ]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("freeform");
      expect(cap.sizes).toContain("2048x2048");
      expect(cap.nMax).toBe(4);
      expect(cap.freeform).toEqual({
        minPixels: 3_686_400,
        maxPixels: 16_777_216,
      });
    }

    // 4-0: lower pixel floor.
    for (const id of ["doubao-seedream-4-0-250828", "seedream-4.0"]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("freeform");
      expect(cap.freeform).toEqual({
        minPixels: 921_600,
        maxPixels: 16_777_216,
      });
    }

    // Unrecognized versions fall through to the unconstrained family rule.
    const fallback = imageCapabilityFor("seedream-9");
    expect(fallback.sizeMode).toBe("freeform");
    expect(fallback.freeform).toBeUndefined();
  });

  it("makes qwen-image-2.0/3.0 freeform with a pixel window", () => {
    for (const id of [
      "qwen-image-2.0",
      "qwen-image-2.0-pro",
      "qwen-image-2-0",
      "ali/qwen-image-3.0",
    ]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("freeform");
      expect(cap.nMax).toBe(6);
      expect(cap.freeform).toEqual({
        minPixels: 262_144,
        maxPixels: 4_194_304,
      });
    }
  });

  it("keeps qwen-image fixed-tier (1472x1104, not 1140)", () => {
    for (const id of ["qwen-image", "ali/qwen-image-plus"]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("openai-size");
      expect(cap.sizes).toEqual([
        "1328x1328",
        "1664x928",
        "928x1664",
        "1472x1104",
        "1104x1472",
      ]);
      expect(cap.nMax).toBe(4);
    }
  });

  it("splits the wan family into pro / other wan2.x / wanx", () => {
    // wan2.7-image-pro: the full 768^2 .. 4096^2 window.
    const pro = imageCapabilityFor("wan2.7-image-pro");
    expect(pro.sizeMode).toBe("freeform");
    expect(pro.nMax).toBe(4);
    expect(pro.freeform).toEqual({
      minPixels: 589_824,
      maxPixels: 16_777_216,
      ratioMin: 1 / 8,
      ratioMax: 8,
    });

    // Other wan2.x: same window capped at 2048^2 pixels.
    for (const id of ["wan2.7-image", "wan2.5-t2i", "wan2.6-image"]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("freeform");
      expect(cap.nMax).toBe(4);
      expect(cap.sizes).not.toContain("4096x4096");
      expect(cap.freeform).toEqual({
        minPixels: 589_824,
        maxPixels: 4_194_304,
        ratioMin: 1 / 8,
        ratioMax: 8,
      });
    }

    // wanx2.1 and below: per-side bounds, not the qwen fixed tiers (4 of the
    // 5 tiers would exceed the 1440px side cap).
    for (const id of ["wanx2.1-t2i-turbo", "wanx2.1-t2i-plus", "wanx-v1"]) {
      const cap = imageCapabilityFor(id);
      expect(cap.sizeMode).toBe("freeform");
      expect(cap.nMax).toBe(4);
      expect(cap.freeform).toEqual({ minSide: 512, maxSide: 1440 });
    }
  });

  it("does not confuse non-gemini image models with the gemini rule", () => {
    expect(imageCapabilityFor("gpt-image-1").sizeMode).toBe("openai-size");
    expect(imageCapabilityFor("gpt-image-1").qualities).toContain("auto");
  });

  it("falls back to the default capability for unknown models", () => {
    expect(imageCapabilityFor("flux-1.1-pro")).toBe(DEFAULT_IMAGE_CAPABILITY);
    expect(imageCapabilityFor("some-vendor/mystery-model")).toBe(
      DEFAULT_IMAGE_CAPABILITY,
    );
  });
});

describe("freeformRules", () => {
  it("produces all five rule kinds from a full constraint set", () => {
    expect(
      freeformRules({
        divisibleBy: 16,
        ratioMin: 1 / 3,
        ratioMax: 3,
        maxSide: 3840,
        minSide: 512,
        minPixels: 262_144,
        maxPixels: 4_194_304,
      }),
    ).toEqual([
      { kind: "divisible", n: 16 },
      { kind: "ratio", min: 1 / 3, max: 3 },
      { kind: "maxSide", n: 3840 },
      { kind: "minSide", n: 512 },
      { kind: "pixels", min: 262_144, max: 4_194_304 },
    ]);
  });

  it("omits rules whose fields are absent", () => {
    expect(freeformRules({ maxSide: 3840 })).toEqual([
      { kind: "maxSide", n: 3840 },
    ]);
    expect(freeformRules({ minSide: 512 })).toEqual([
      { kind: "minSide", n: 512 },
    ]);
    expect(
      freeformRules({ minPixels: 3_686_400, maxPixels: 16_777_216 }),
    ).toEqual([{ kind: "pixels", min: 3_686_400, max: 16_777_216 }]);
    // One-sided ratio/pixel bounds do not form a rule.
    expect(freeformRules({ ratioMin: 1 / 8 })).toEqual([]);
    expect(freeformRules({ minPixels: 921_600 })).toEqual([]);
  });

  it("returns [] for undefined and empty constraints", () => {
    expect(freeformRules(undefined)).toEqual([]);
    expect(freeformRules({})).toEqual([]);
    expect(freeformRules(DEFAULT_IMAGE_CAPABILITY.freeform)).toEqual([]);
  });
});

describe("formatRatioBound", () => {
  it("formats >=1 bounds as N:1 and <1 bounds as 1:N", () => {
    expect(formatRatioBound(3)).toBe("3:1");
    expect(formatRatioBound(8)).toBe("8:1");
    expect(formatRatioBound(1 / 3)).toBe("1:3");
    expect(formatRatioBound(1 / 8)).toBe("1:8");
    expect(formatRatioBound(1)).toBe("1:1");
  });
});

describe("validateFreeformSize", () => {
  it("accepts sizes within the constraints", () => {
    expect(validateFreeformSize("1536x864", GPT_IMAGE_2_CONSTRAINTS)).toBe(true);
    expect(validateFreeformSize("3840x2160", GPT_IMAGE_2_CONSTRAINTS)).toBe(true);
  });

  it("rejects divisibility, ratio, and side-limit violations", () => {
    expect(validateFreeformSize("1537x864", GPT_IMAGE_2_CONSTRAINTS)).toBe(false);
    expect(validateFreeformSize("4000x100", GPT_IMAGE_2_CONSTRAINTS)).toBe(false);
    expect(validateFreeformSize("3841x16", GPT_IMAGE_2_CONSTRAINTS)).toBe(false);
    expect(validateFreeformSize("0x1024", GPT_IMAGE_2_CONSTRAINTS)).toBe(false);
  });

  it("accepts any well-formed WxH without constraints", () => {
    expect(validateFreeformSize("1234x567")).toBe(true);
    expect(validateFreeformSize("1234x567", {})).toBe(true);
  });

  it("enforces the total-pixel window at both bounds", () => {
    // seedream-4.5: 3,686,400 .. 16,777,216 pixels.
    const seedream45 = imageCapabilityFor("doubao-seedream-4-5-251128").freeform;
    expect(validateFreeformSize("1024x1024", seedream45)).toBe(false);
    expect(validateFreeformSize("2048x2048", seedream45)).toBe(true);
    expect(validateFreeformSize("4096x4096", seedream45)).toBe(true);
    expect(validateFreeformSize("4097x4096", seedream45)).toBe(false);

    // qwen-image-2.0: 512x512 .. 2048x2048 pixels.
    const qwen = imageCapabilityFor("qwen-image-2.0-pro").freeform;
    expect(validateFreeformSize("512x512", qwen)).toBe(true);
    expect(validateFreeformSize("512x511", qwen)).toBe(false);
    expect(validateFreeformSize("2048x2048", qwen)).toBe(true);
    expect(validateFreeformSize("2048x2049", qwen)).toBe(false);
  });

  it("enforces the per-side floor and ceiling of wanx models", () => {
    const wanx = imageCapabilityFor("wanx2.1-t2i-turbo").freeform;
    expect(validateFreeformSize("511x1440", wanx)).toBe(false);
    expect(validateFreeformSize("512x1440", wanx)).toBe(true);
    expect(validateFreeformSize("1440x512", wanx)).toBe(true);
    expect(validateFreeformSize("1024x1024", wanx)).toBe(true);
    expect(validateFreeformSize("1441x512", wanx)).toBe(false);
  });

  it("rejects malformed sizes", () => {
    expect(validateFreeformSize("huge")).toBe(false);
    expect(validateFreeformSize("1024X768")).toBe(false);
    expect(validateFreeformSize("1024x")).toBe(false);
  });
});
