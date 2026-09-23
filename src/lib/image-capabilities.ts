/**
 * Static capability table for image-generation models. Provider listing
 * endpoints do not return image parameters (sizes, counts, quality tiers —
 * see `.trellis/spec/backend/provider-configs.md`), so parameter support is
 * maintained here as a pattern table. Client-safe (same role as
 * `provider-format.ts`): the composer renders the options, the server
 * validates against the same table before calling the provider.
 */

export type ImageSizeMode = "openai-size" | "aspect-ratio" | "freeform";

/** Server-measured limits for freeform models (gpt-image-2/2.5, 2026-09 docs). */
export type ImageFreeformConstraints = {
  /** Both width and height must be divisible by this. */
  divisibleBy?: number;
  /** Minimum width/height ratio. */
  ratioMin?: number;
  /** Maximum width/height ratio. */
  ratioMax?: number;
  /** Single-side floor; applies to whichever side is shorter. */
  minSide?: number;
  /** Longest-side ceiling (single side: portrait examples like 2160x3840
   *  mean the cap applies to either side, not to width alone). */
  maxSide?: number;
  /** Total-pixel floor, width*height (seedream-4.5: 3,686,400). */
  minPixels?: number;
  /** Total-pixel ceiling, width*height (seedream: 4096x4096). */
  maxPixels?: number;
};

export type ImageModelCapability = {
  sizeMode: ImageSizeMode;
  /** openai-size/freeform: pixel tiers like "1024x1024"; aspect-ratio: "1:1". */
  sizes: string[];
  nMax: number;
  /** Quality tiers, OpenAI-style image models only. */
  qualities?: string[];
  /** Gemini `imageConfig.imageSize` tiers ("1K" | "2K" | "4K"). */
  imageSizes?: string[];
  /** Freeform-only limits; absent means any well-formed "WxH" is accepted. */
  freeform?: ImageFreeformConstraints;
};

export const DEFAULT_IMAGE_CAPABILITY: ImageModelCapability = {
  sizeMode: "freeform",
  sizes: ["1024x1024", "1344x768", "768x1344", "1536x640", "640x1536"],
  nMax: 1,
};

type FamilyRule = {
  matches: (id: string) => boolean;
  capability: ImageModelCapability;
};

/**
 * Order is priority: the first matching rule wins, so more specific families
 * must precede broader ones. Matchers run against the lowercase last path
 * segment of the model id (`google/gemini-2.5-flash-image` →
 * `gemini-2.5-flash-image`).
 */
// gpt-image-2/2.5 share one constraint set (2026-09 official docs): any WxH,
// both sides divisible by 16, aspect ratio between 1:3 and 3:1, 3840 ceiling.
const GPT_IMAGE_2_FREEFORM: ImageFreeformConstraints = {
  divisibleBy: 16,
  ratioMin: 1 / 3,
  ratioMax: 3,
  maxSide: 3840,
};

const FAMILY_RULES: FamilyRule[] = [
  {
    // Must precede the gpt-image-2 rule: "gpt-image-2.5-flare" also contains
    // "gpt-image-2".
    matches: (id) => id.includes("gpt-image-2.5"),
    capability: {
      sizeMode: "freeform",
      sizes: [
        "1024x1024",
        "1536x1024",
        "1024x1536",
        "2048x2048",
        "2048x1152",
        "3840x2160",
        "2160x3840",
      ],
      nMax: 10,
      qualities: ["low", "medium", "high", "xhigh", "max", "auto"],
      freeform: GPT_IMAGE_2_FREEFORM,
    },
  },
  {
    matches: (id) => id.includes("gpt-image-2"),
    capability: {
      sizeMode: "freeform",
      sizes: [
        "1024x1024",
        "1536x1024",
        "1024x1536",
        "2048x2048",
        "2048x1152",
        "3840x2160",
      ],
      nMax: 10,
      qualities: ["low", "medium", "high", "auto"],
      freeform: GPT_IMAGE_2_FREEFORM,
    },
  },
  {
    // gpt-image-1 / 1.5 / 1-mini: fixed tiers only (official n range 1-10).
    matches: (id) => id.includes("gpt-image"),
    capability: {
      sizeMode: "openai-size",
      sizes: ["1024x1024", "1536x1024", "1024x1536"],
      nMax: 10,
      qualities: ["low", "medium", "high", "auto"],
    },
  },
  {
    matches: (id) => id.includes("dall-e-3"),
    capability: {
      sizeMode: "openai-size",
      sizes: ["1024x1024", "1792x1024", "1024x1792"],
      nMax: 1,
      qualities: ["standard", "hd"],
    },
  },
  {
    matches: (id) => id.includes("dall-e-2"),
    capability: {
      sizeMode: "openai-size",
      sizes: ["256x256", "512x512", "1024x1024"],
      // Official n range is 1-10; only dall-e-3 is capped at 1.
      nMax: 10,
    },
  },
  {
    // Nano Banana 2 / Pro (2026-09 docs): the 10 base ratios plus five
    // extreme ones, and 1K-4K imageSize tiers. "lite" is excluded so
    // gemini-3.1-flash-lite-image falls through to the 1K-only rule.
    matches: (id) =>
      (id.includes("gemini-3.1-flash-image") && !id.includes("lite")) ||
      id.includes("gemini-3-pro-image"),
    capability: {
      sizeMode: "aspect-ratio",
      sizes: [
        "1:1",
        "3:2",
        "2:3",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
        "1:4",
        "4:1",
        "1:8",
        "8:1",
        "9:21",
      ],
      nMax: 4,
      imageSizes: ["1K", "2K", "4K"],
    },
  },
  {
    // Other native Gemini image models (gemini-2.5-flash-image,
    // gemini-3.1-flash-lite-image): 10 ratios and 1K only — a 2K/4K
    // request is an upstream 400.
    matches: (id) =>
      id.includes("nanobanana") ||
      (id.includes("gemini") && id.includes("image")),
    capability: {
      sizeMode: "aspect-ratio",
      sizes: [
        "1:1",
        "3:2",
        "2:3",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
      ],
      nMax: 4,
      imageSizes: ["1K"],
    },
  },
  // Seedream (ark ids like "doubao-seedream-4-5-251128"; gateways also use
  // the dotted form "seedream-4.5" — both match). The "2K"/"4K" size
  // keywords are deliberately not modeled: explicit WxH works on every
  // version, and the aspect-ratio range is left to the provider to enforce.
  {
    // Officially single-image only; docs give keyword tiers, no pixel bounds.
    matches: (id) =>
      id.includes("seedream-5-0-pro") || id.includes("seedream-5.0-pro"),
    capability: {
      sizeMode: "freeform",
      sizes: ["1024x1024", "2048x2048"],
      nMax: 1,
    },
  },
  {
    // seedream-5-0-lite / 4-5: 1024x1024 is below the pixel floor.
    matches: (id) =>
      id.includes("seedream-5-0-lite") ||
      id.includes("seedream-5.0-lite") ||
      id.includes("seedream-4-5") ||
      id.includes("seedream-4.5"),
    capability: {
      sizeMode: "freeform",
      sizes: [
        "2048x2048",
        "2304x1728",
        "1728x2304",
        "2560x1440",
        "1440x2560",
        "2496x1664",
        "1664x2496",
        "3024x1296",
      ],
      nMax: 4,
      freeform: { minPixels: 3_686_400, maxPixels: 16_777_216 },
    },
  },
  {
    // seedream-4-0: 1280x720 .. 4096x4096.
    matches: (id) =>
      id.includes("seedream-4-0") || id.includes("seedream-4.0"),
    capability: {
      sizeMode: "freeform",
      sizes: ["1280x720", "720x1280", "1024x1024", "2048x2048", "4096x4096"],
      nMax: 4,
      freeform: { minPixels: 921_600, maxPixels: 16_777_216 },
    },
  },
  {
    // Unrecognized seedream versions: freeform, unconstrained.
    matches: (id) => id.includes("seedream"),
    capability: {
      sizeMode: "freeform",
      sizes: [
        "2048x2048",
        "2304x1728",
        "1728x2304",
        "2560x1440",
        "1440x2560",
        "2496x1664",
        "1664x2496",
        "3024x1296",
      ],
      nMax: 4,
    },
  },
  {
    // qwen-image-2.0/3.0 (incl. -pro; dash or dot form): 512^2 .. 2048^2
    // total pixels. Must precede the fixed-tier qwen-image rule.
    matches: (id) =>
      id.includes("qwen-image-2.0") ||
      id.includes("qwen-image-2-0") ||
      id.includes("qwen-image-3.0") ||
      id.includes("qwen-image-3-0"),
    capability: {
      sizeMode: "freeform",
      sizes: ["1024x1024", "2048x2048", "1664x928", "928x1664"],
      nMax: 6,
      freeform: { minPixels: 262_144, maxPixels: 4_194_304 },
    },
  },
  {
    // wan2.7-image-pro: the full 768^2 .. 4096^2 pixel window. Must precede
    // the general wan2. rule ("wan2.7-image-pro" contains "wan2.").
    matches: (id) => id.includes("wan2.7-image-pro"),
    capability: {
      sizeMode: "freeform",
      sizes: ["1024x1024", "2048x2048", "2048x1152", "1152x2048", "4096x4096"],
      nMax: 4,
      freeform: {
        minPixels: 589_824,
        maxPixels: 16_777_216,
        ratioMin: 1 / 8,
        ratioMax: 8,
      },
    },
  },
  {
    // Other wan2.x (wan2.7-image, 2.5/2.6): capped at 2048^2 pixels (their
    // real ratio range is narrower than 1:8..8:1; the upstream 400 is the
    // backstop). "wanx2.1" does not contain "wan2.", so the families stay
    // disjoint.
    matches: (id) => id.includes("wan2."),
    capability: {
      sizeMode: "freeform",
      sizes: ["1024x1024", "2048x2048", "2048x1152", "1152x2048"],
      nMax: 4,
      freeform: {
        minPixels: 589_824,
        maxPixels: 4_194_304,
        ratioMin: 1 / 8,
        ratioMax: 8,
      },
    },
  },
  {
    // wanx2.1 and below (wanx2.1-t2i-turbo/plus, wanx-v1): per-side bounds,
    // not a pixel window — the qwen fixed tiers would exceed the 1440 cap.
    matches: (id) => id.includes("wanx"),
    capability: {
      sizeMode: "freeform",
      sizes: ["1024x1024", "1280x720", "720x1280"],
      nMax: 4,
      freeform: { minSide: 512, maxSide: 1440 },
    },
  },
  {
    // qwen-image / -plus / -max: fixed tiers only.
    matches: (id) => id.includes("qwen-image"),
    capability: {
      sizeMode: "openai-size",
      sizes: ["1328x1328", "1664x928", "928x1664", "1472x1104", "1104x1472"],
      nMax: 4,
    },
  },
];

/**
 * Resolves the parameter capability of an image model by id pattern. Unknown
 * models fall back to {@link DEFAULT_IMAGE_CAPABILITY} — conservative presets
 * plus freeform custom size, single image.
 */
export function imageCapabilityFor(modelId: string): ImageModelCapability {
  const segment = modelId.split("/").pop()?.toLowerCase() ?? "";
  for (const rule of FAMILY_RULES) {
    if (rule.matches(segment)) {
      return rule.capability;
    }
  }
  return DEFAULT_IMAGE_CAPABILITY;
}

const FREEFORM_SIZE_PATTERN = /^(\d+)x(\d+)$/;

/** One human-readable rule derived from freeform constraints. */
export type ImageFreeformRule =
  | { kind: "divisible"; n: number }
  | { kind: "ratio"; min: number; max: number }
  | { kind: "maxSide"; n: number }
  | { kind: "minSide"; n: number }
  | { kind: "pixels"; min: number; max: number };

/**
 * Turns freeform constraints into the structured rule list the picker's info
 * tooltip renders. Only rules actually present in the constraints are
 * produced; undefined/empty constraints yield []. Isomorphic lib: no i18n
 * here, the component translates each rule.
 */
export function freeformRules(
  constraints: ImageFreeformConstraints | undefined,
): ImageFreeformRule[] {
  if (!constraints) {
    return [];
  }
  const rules: ImageFreeformRule[] = [];
  if (constraints.divisibleBy !== undefined) {
    rules.push({ kind: "divisible", n: constraints.divisibleBy });
  }
  if (
    constraints.ratioMin !== undefined &&
    constraints.ratioMax !== undefined
  ) {
    rules.push({
      kind: "ratio",
      min: constraints.ratioMin,
      max: constraints.ratioMax,
    });
  }
  if (constraints.maxSide !== undefined) {
    rules.push({ kind: "maxSide", n: constraints.maxSide });
  }
  if (constraints.minSide !== undefined) {
    rules.push({ kind: "minSide", n: constraints.minSide });
  }
  if (
    constraints.minPixels !== undefined &&
    constraints.maxPixels !== undefined
  ) {
    rules.push({
      kind: "pixels",
      min: constraints.minPixels,
      max: constraints.maxPixels,
    });
  }
  return rules;
}

/**
 * Whether a requested size is usable for the capability: an explicit preset
 * always is, and freeform models additionally accept a custom "WxH" inside
 * their constraints. Shared by the composer sanitize and the server gate so
 * both apply the same rule.
 */
export function isSizeAllowed(
  capability: ImageModelCapability,
  size: string,
): boolean {
  return (
    capability.sizes.includes(size) ||
    (capability.sizeMode === "freeform" &&
      validateFreeformSize(size, capability.freeform))
  );
}

/**
 * Formats a ratio bound as `1:3` / `3:1`. Table values are 3, 1/3, 8, 1/8,
 * so toPrecision(6) cleans the float noise and Math.round is safe.
 */
export function formatRatioBound(value: number): string {
  const v = Number(value.toPrecision(6));
  return v < 1 ? `1:${Math.round(1 / v)}` : `${v}:1`;
}

/**
 * Validates a freeform "WxH" size: positive integers, then the model's
 * divisibility / aspect-ratio / longest-side constraints when present. Shared
 * by the composer sanitize, the picker input, and the server-side gate so all
 * three agree on what a provider will accept.
 */
export function validateFreeformSize(
  size: string,
  constraints?: ImageFreeformConstraints,
): boolean {
  const match = FREEFORM_SIZE_PATTERN.exec(size);
  if (!match) {
    return false;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return false;
  }
  if (!constraints) {
    return true;
  }
  if (
    constraints.divisibleBy !== undefined &&
    (width % constraints.divisibleBy !== 0 ||
      height % constraints.divisibleBy !== 0)
  ) {
    return false;
  }
  const ratio = width / height;
  if (constraints.ratioMin !== undefined && ratio < constraints.ratioMin) {
    return false;
  }
  if (constraints.ratioMax !== undefined && ratio > constraints.ratioMax) {
    return false;
  }
  if (
    constraints.maxSide !== undefined &&
    Math.max(width, height) > constraints.maxSide
  ) {
    return false;
  }
  if (
    constraints.minSide !== undefined &&
    Math.min(width, height) < constraints.minSide
  ) {
    return false;
  }
  const pixels = width * height;
  if (constraints.minPixels !== undefined && pixels < constraints.minPixels) {
    return false;
  }
  if (constraints.maxPixels !== undefined && pixels > constraints.maxPixels) {
    return false;
  }
  return true;
}
