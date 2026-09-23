import { describe, expect, it } from "vitest";

import { imageRequestParams } from "./image-params";

const GEMINI = "google/gemini-3-pro-image";
const GPT_IMAGE = "openai/gpt-image-1";

describe("imageRequestParams", () => {
  it("omits the image field entirely when nothing is set", () => {
    expect(imageRequestParams({}, GEMINI)).toBeUndefined();
    expect(
      imageRequestParams({ size: undefined, n: undefined }, GEMINI),
    ).toBeUndefined();
  });

  it("keeps only the params the user set", () => {
    expect(
      imageRequestParams({ size: "1:1", n: 2, quality: undefined }, GEMINI),
    ).toEqual({ size: "1:1", n: 2 });
    expect(imageRequestParams({ imageSize: "2K" }, GEMINI)).toEqual({
      imageSize: "2K",
    });
  });

  it("drops an imageSize tier the model does not offer", () => {
    // gemini-2.5-flash-image is 1K-only; a stale 2K pick goes away.
    expect(
      imageRequestParams({ imageSize: "2K" }, "gemini-2.5-flash-image"),
    ).toBeUndefined();
    expect(
      imageRequestParams({ imageSize: "1K" }, "gemini-2.5-flash-image"),
    ).toEqual({ imageSize: "1K" });
  });

  it("keeps a freeform custom size for a freeform model", () => {
    expect(
      imageRequestParams({ size: "1234x567" }, "seedream-9"),
    ).toEqual({ size: "1234x567" });
  });

  it("drops a custom size below the model's pixel floor", () => {
    // seedream-4.5 rejects anything under 3,686,400 pixels (1024x1024).
    expect(
      imageRequestParams({ size: "1024x1024" }, "doubao-seedream-4-5-251128"),
    ).toBeUndefined();
    expect(
      imageRequestParams({ size: "2048x2048" }, "doubao-seedream-4-5-251128"),
    ).toEqual({ size: "2048x2048" });
  });

  it("drops params left over from a previously selected image family", () => {
    // gemini aspect-ratio + imageSize tier picked, then switched to gpt-image:
    // neither is valid there and the request must go out with provider
    // defaults instead of a silent 400.
    expect(
      imageRequestParams({ size: "1:1", imageSize: "2K" }, GPT_IMAGE),
    ).toBeUndefined();
    // …and a gpt-image size + quality do not survive a switch to gemini.
    expect(
      imageRequestParams({ size: "1024x1024", quality: "high" }, GEMINI),
    ).toBeUndefined();
  });

  it("keeps params that remain valid across a family switch", () => {
    // gpt-image → dall-e-3: 1024x1024 exists in both tables.
    expect(
      imageRequestParams({ size: "1024x1024", quality: "high" }, "dall-e-3"),
    ).toEqual({ size: "1024x1024" });
  });

  it("clamps n into the model's range", () => {
    expect(imageRequestParams({ n: 4 }, "dall-e-3")).toEqual({ n: 1 });
    expect(imageRequestParams({ n: 0 }, GPT_IMAGE)).toEqual({ n: 1 });
    expect(imageRequestParams({ n: 3 }, GPT_IMAGE)).toEqual({ n: 3 });
  });

  it("drops a malformed custom size even for a freeform model", () => {
    expect(
      imageRequestParams({ size: "huge" }, "doubao-seedream-4-5"),
    ).toBeUndefined();
  });

  it("keeps a constraint-satisfying custom size for constrained freeform models", () => {
    expect(imageRequestParams({ size: "1536x864" }, "gpt-image-2")).toEqual({
      size: "1536x864",
    });
  });

  it("drops a custom size that violates the model's freeform constraints", () => {
    // 1537 is not divisible by 16.
    expect(
      imageRequestParams({ size: "1537x864" }, "gpt-image-2"),
    ).toBeUndefined();
    // 4000/100 exceeds the 3:1 ratio cap (and both the side ceiling).
    expect(
      imageRequestParams({ size: "4000x100" }, "openai/gpt-image-2.5-flare"),
    ).toBeUndefined();
  });
});
