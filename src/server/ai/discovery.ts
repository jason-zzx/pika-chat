import "server-only";

import { z } from "zod";

import type { AppErrorMessageKey } from "@/lib/api/error-contract";
import type { ProviderApiFormat } from "@/lib/provider-format";
import { AppError } from "@/server/errors";

const dataModelsSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

const googleModelsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      // Gemini-compatible gateways emit `null` for fields the upstream left
      // unset, so this is nullable as well as optional — a bare `.optional()`
      // rejects `null` and fails the whole listing.
      supportedGenerationMethods: z.array(z.string()).nullish(),
    }),
  ),
});

type DiscoveryOptions = {
  apiFormat: ProviderApiFormat;
  baseUrl: string;
  apiKey: string | null;
};

/** Anthropic gates every request on a protocol version header. */
const ANTHROPIC_VERSION = "2023-06-01";

const GOOGLE_MODELS_PREFIX = /^models\//;
const GENERATE_CONTENT_METHOD = "generateContent";

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function providerStatusKey(status: number): AppErrorMessageKey {
  if (status === 401 || status === 403) {
    return "provider.credentialsRejected";
  }
  if (status === 404) {
    return "provider.discoveryUnsupported";
  }
  return "provider.httpStatus";
}

function unexpectedResponse(): AppError {
  return new AppError("PROVIDER_ERROR", 502, "provider.unexpectedResponse");
}

function authHeaders(entries: Array<[string, string | null]>): Headers {
  const headers = new Headers();
  for (const [name, value] of entries) {
    if (value) {
      headers.set(name, value);
    }
  }
  return headers;
}

/** Exhaustively typed, like the other per-format maps: a new format fails to
 * compile here instead of silently inheriting OpenAI's auth. */
const FORMAT_AUTH: Record<
  ProviderApiFormat,
  (apiKey: string | null) => Headers
> = {
  "openai-compatible": (apiKey) =>
    authHeaders([["authorization", apiKey ? `Bearer ${apiKey}` : null]]),
  claude: (apiKey) =>
    authHeaders([
      ["anthropic-version", ANTHROPIC_VERSION],
      ["x-api-key", apiKey],
    ]),
  google: (apiKey) => authHeaders([["x-goog-api-key", apiKey]]),
};

/**
 * Google lists every model it serves, embedding and image models included.
 * `supportedGenerationMethods` is the only signal that separates them, and
 * self-hosted gateways routinely report it as `null` or omit it — those are
 * kept rather than hidden.
 */
function servesGenerateContent(model: {
  supportedGenerationMethods?: string[] | null | undefined;
}): boolean {
  const methods = model.supportedGenerationMethods;
  if (methods === undefined || methods === null) {
    return true;
  }
  return methods.includes(GENERATE_CONTENT_METHOD);
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

function dataListModelIds(payload: unknown): string[] {
  return parseOrThrow(dataModelsSchema, payload).data.map((model) => model.id);
}

/** Exhaustively typed as well: google is the only format that does not answer
 * with the `{ data: [{ id }] }` shape. */
const FORMAT_PARSER: Record<
  ProviderApiFormat,
  (payload: unknown) => string[]
> = {
  "openai-compatible": dataListModelIds,
  claude: dataListModelIds,
  google: (payload) =>
    parseOrThrow(googleModelsSchema, payload)
      .models.filter(servesGenerateContent)
      .map((model) => model.name.replace(GOOGLE_MODELS_PREFIX, "")),
};

export async function fetchServedModelIds(
  options: DiscoveryOptions,
): Promise<string[]> {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/models`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: FORMAT_AUTH[options.apiFormat](options.apiKey),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new AppError("PROVIDER_ERROR", 502, "provider.timedOut");
    }
    throw new AppError("PROVIDER_ERROR", 502, "provider.unreachable");
  }

  if (!response.ok) {
    if (response.body) {
      await response.body.cancel();
    }
    const messageKey = providerStatusKey(response.status);
    throw new AppError(
      "PROVIDER_ERROR",
      502,
      messageKey,
      messageKey === "provider.httpStatus" ? { status: response.status } : undefined,
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw unexpectedResponse();
  }

  return FORMAT_PARSER[options.apiFormat](parsed);
}
