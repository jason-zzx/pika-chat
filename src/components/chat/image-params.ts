import {
  imageCapabilityFor,
  isSizeAllowed,
} from "@/lib/image-capabilities";
import type { ComposerImageParams } from "@/stores/composer-store";

/**
 * Request-body `image` field for an image-mode send, sanitized against the
 * selected model's capability table: params left over from a previously
 * selected image family (the store is per-draft and outlives a model switch)
 * are dropped or clamped instead of hitting the server as a silent 400 —
 * a size outside a non-freeform table goes away (freeform keeps a custom
 * "WxH" that satisfies the model's constraints), quality/imageSize tiers the model does not declare go away,
 * and n clamps to [1, nMax]. Returns undefined when nothing valid is set so
 * the key is omitted from the body entirely. The server still re-validates
 * (`assertImageGenerationSupported`) as the backstop.
 */
export function imageRequestParams(
  params: ComposerImageParams,
  modelId: string,
): ComposerImageParams | undefined {
  const capability = imageCapabilityFor(modelId);
  const out: ComposerImageParams = {};
  if (params.size !== undefined && isSizeAllowed(capability, params.size)) {
    out.size = params.size;
  }
  if (params.n !== undefined) {
    out.n = Math.min(Math.max(Math.trunc(params.n), 1), capability.nMax);
  }
  if (
    params.quality !== undefined &&
    capability.qualities?.includes(params.quality)
  ) {
    out.quality = params.quality;
  }
  if (
    params.imageSize !== undefined &&
    capability.imageSizes?.includes(params.imageSize)
  ) {
    out.imageSize = params.imageSize;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
