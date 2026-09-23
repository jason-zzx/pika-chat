import "server-only";

import { APICallError } from "ai";
import { z } from "zod";

import {
  imageCapabilityFor,
  type ImageModelCapability,
} from "@/lib/image-capabilities";
import type { ProviderApiFormat } from "@/lib/provider-format";
import type { ProviderEndpoint } from "@/server/ai/provider-factory";
import { AppError } from "@/server/errors";

export type GeneratedImage = { bytes: Buffer; mediaType: string };

export type ImageGenParams = {
  prompt: string;
  size?: string;
  n: number;
  quality?: string;
  imageSize?: string;
};

export type ImageGenResult = {
  images: GeneratedImage[];
  /** Gemini image models may return accompanying text alongside the image. */
  text?: string;
};

/** Image generation is slow; well above the 10s discovery timeout. */
const GENERATION_TIMEOUT_MS = 120_000;

const IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const FALLBACK_MEDIA_TYPE = "image/png";

// Gemini-compatible gateways emit explicit `null` for unset fields, so every
// optional field is `.nullish()` — a bare `.optional()` rejects `null` and
// fails the whole response (see provider-configs spec / discovery.ts).
const openAiImagesResponseSchema = z.object({
  data: z.array(
    z.object({
      b64_json: z.string().nullish(),
      url: z.string().nullish(),
    }),
  ),
});

const googleResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().nullish(),
                  // Gemini 3 thinking parts: collected text must skip them.
                  thought: z.boolean().nullish(),
                  inlineData: z
                    .object({
                      data: z.string().nullish(),
                      mimeType: z.string().nullish(),
                    })
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .nullish(),
      }),
    )
    .nullish(),
});

function unexpectedResponse(): AppError {
  return new AppError("PROVIDER_ERROR", 502, "provider.unexpectedResponse");
}

/* --- ImageGenParams → vendor payload mapping (kept next to its transport) --- */

/**
 * OpenAI Images API (`POST /images/generations`). `size` passes through
 * verbatim for every sizeMode: openai-size and freeform are already "WxH",
 * and an aspect-ratio tier on a gateway-served model is the gateway's call.
 * Always requests b64_json; gateways that only return `url` are handled in
 * the response parser.
 */
function openAiImagesRequestBody(
  modelId: string,
  params: ImageGenParams,
): Record<string, unknown> {
  return {
    model: modelId,
    prompt: params.prompt,
    n: params.n,
    response_format: "b64_json",
    ...(params.size ? { size: params.size } : {}),
    ...(params.quality ? { quality: params.quality } : {}),
  };
}

/**
 * Gemini `generateContent`. Only aspect-ratio models carry an `imageConfig`
 * (aspectRatio from `size`, imageSize from the capability's `imageSizes`
 * tiers); other size modes have no Gemini-side parameter to map to.
 * `responseModalities` must list IMAGE and TEXT — Gemini image models answer
 * through `generateContent` with base64 in `inlineData`, not a dedicated
 * image endpoint.
 */
function googleImageRequestBody(
  params: ImageGenParams,
  capability: ImageModelCapability,
): Record<string, unknown> {
  const imageConfig: Record<string, string> = {};
  if (capability.sizeMode === "aspect-ratio") {
    if (params.size) {
      imageConfig.aspectRatio = params.size;
    }
    if (params.imageSize) {
      imageConfig.imageSize = params.imageSize;
    }
  }
  return {
    contents: [{ role: "user", parts: [{ text: params.prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
    },
  };
}

function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  payload: unknown,
): z.output<Schema> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw unexpectedResponse();
  }
  return result.data;
}

/**
 * POSTs a JSON body and parses the JSON response. Non-2xx becomes an
 * `APICallError` so the caller's `describeProviderError` applies the same
 * status → `provider.*` key mapping and scrubbed-verbatim pass-through as the
 * streaming paths — including a 400 whose upstream `error` text lists the
 * legal parameter values. Network failures and aborts propagate as-is;
 * `describeProviderError` maps those to `provider.unreachable` /
 * `provider.timedOut`.
 */
async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Headers,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const responseBody = await response.text().catch(() => undefined);
    throw new APICallError({
      message: `Image generation request failed with status ${response.status}`,
      url,
      requestBodyValues: body,
      statusCode: response.status,
      responseBody,
      isRetryable: false,
    });
  }
  return response.json().catch(() => {
    throw unexpectedResponse();
  });
}

function normalizeMediaType(contentType: string | null): string {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  return IMAGE_MEDIA_TYPES.has(mediaType) ? mediaType : FALLBACK_MEDIA_TYPE;
}

/** Magic-byte sniffing for b64 payloads that declare no media type. */
function sniffImageMediaType(bytes: Buffer): string {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "GIF8") {
    return "image/gif";
  }
  return FALLBACK_MEDIA_TYPE;
}

/** A gateway that ignores `response_format: "b64_json"` answers with URLs. */
async function downloadImage(
  url: string,
  signal: AbortSignal,
): Promise<GeneratedImage> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    if (response.body) {
      await response.body.cancel();
    }
    throw new APICallError({
      message: `Image download failed with status ${response.status}`,
      url,
      requestBodyValues: {},
      statusCode: response.status,
      isRetryable: false,
    });
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mediaType: normalizeMediaType(response.headers.get("content-type")),
  };
}

type ImageAdapter = (
  endpoint: ProviderEndpoint,
  modelId: string,
  params: ImageGenParams,
  signal: AbortSignal,
) => Promise<ImageGenResult>;

const openAiCompatibleAdapter: ImageAdapter = async (
  endpoint,
  modelId,
  params,
  signal,
) => {
  const url = `${endpoint.baseUrl.replace(/\/+$/, "")}/images/generations`;
  // openai-compatible keeps the key optional, like discovery.
  const headers = new Headers({ "content-type": "application/json" });
  if (endpoint.apiKey) {
    headers.set("authorization", `Bearer ${endpoint.apiKey}`);
  }
  const payload = parseOrThrow(
    openAiImagesResponseSchema,
    await postJson(url, openAiImagesRequestBody(modelId, params), headers, signal),
  );
  const images = await Promise.all(
    payload.data.map((item) => {
      if (item.b64_json) {
        const bytes = Buffer.from(item.b64_json, "base64");
        return { bytes, mediaType: sniffImageMediaType(bytes) };
      }
      if (item.url) {
        return downloadImage(item.url, signal);
      }
      throw unexpectedResponse();
    }),
  );
  if (images.length === 0) {
    throw unexpectedResponse();
  }
  return { images };
};

async function generateGoogleImage(
  endpoint: ProviderEndpoint,
  modelId: string,
  params: ImageGenParams,
  signal: AbortSignal,
): Promise<ImageGenResult> {
  const url = `${endpoint.baseUrl.replace(/\/+$/, "")}/models/${modelId}:generateContent`;
  const headers = new Headers({ "content-type": "application/json" });
  if (endpoint.apiKey) {
    headers.set("x-goog-api-key", endpoint.apiKey);
  }
  const payload = parseOrThrow(
    googleResponseSchema,
    await postJson(
      url,
      googleImageRequestBody(params, imageCapabilityFor(modelId)),
      headers,
      signal,
    ),
  );
  const images: GeneratedImage[] = [];
  const texts: string[] = [];
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        images.push({
          bytes: Buffer.from(part.inlineData.data, "base64"),
          mediaType: normalizeMediaType(part.inlineData.mimeType ?? null),
        });
      } else if (part.text && part.thought !== true) {
        texts.push(part.text);
      }
    }
  }
  if (images.length === 0) {
    throw unexpectedResponse();
  }
  return {
    images,
    ...(texts.length > 0 ? { text: texts.join("\n") } : {}),
  };
}

const googleAdapter: ImageAdapter = async (endpoint, modelId, params, signal) => {
  // generateContent yields one image per call, so n fans out into parallel
  // requests and the results merge into one message.
  const results = await Promise.all(
    Array.from({ length: Math.max(1, params.n) }, () =>
      generateGoogleImage(endpoint, modelId, params, signal),
    ),
  );
  return {
    images: results.flatMap((result) => result.images),
    ...(results[0]?.text ? { text: results[0].text } : {}),
  };
};

/**
 * One entry per format, exhaustively keyed like provider-factory.ts: adding a
 * format to `PROVIDER_API_FORMATS` fails compilation here. `null` means the
 * format has no image generation — claude; the chat route rejects image
 * models on such formats before reaching this.
 */
const FORMAT_ADAPTERS: Record<ProviderApiFormat, ImageAdapter | null> = {
  "openai-compatible": openAiCompatibleAdapter,
  claude: null,
  google: googleAdapter,
};

export async function generateImageForEndpoint(
  endpoint: ProviderEndpoint,
  modelId: string,
  params: ImageGenParams,
  signal?: AbortSignal,
): Promise<ImageGenResult> {
  const adapter = FORMAT_ADAPTERS[endpoint.apiFormat];
  if (!adapter) {
    // Defensive: the chat route intercepts image models on claude earlier.
    throw new AppError("VALIDATION_FAILED", 400, "model.imageUnsupported");
  }
  const combined = AbortSignal.any(
    signal
      ? [signal, AbortSignal.timeout(GENERATION_TIMEOUT_MS)]
      : [AbortSignal.timeout(GENERATION_TIMEOUT_MS)],
  );
  return adapter(endpoint, modelId, params, combined);
}
