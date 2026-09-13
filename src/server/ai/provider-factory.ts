import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { ProviderApiFormat } from "@/lib/provider-format";
import {
  withBuiltinWebSearch,
  type FetchFunction,
} from "@/server/ai/builtin-search";

/** One provider config's endpoint, as needed to build an SDK provider. */
export type ProviderEndpoint = {
  apiFormat: ProviderApiFormat;
  name: string;
  baseUrl: string;
  apiKey: string;
};

/**
 * SDK provider instances for the callable formats, shared by the chat-model
 * builders below and the Files API transport so the endpoint wiring exists
 * exactly once. `openai-compatible` is absent: it needs a `name` and
 * `.chatModel()`, and it has no Files API at all.
 */
const FORMAT_SDK_PROVIDERS = {
  claude: (endpoint: ProviderEndpoint, fetchImpl?: FetchFunction) =>
    createAnthropic({
      baseURL: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }),
  google: (endpoint: ProviderEndpoint, fetchImpl?: FetchFunction) =>
    createGoogle({
      baseURL: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }),
} as const;

/**
 * One entry per format. Keys are exhaustively typed, so adding a format to
 * `PROVIDER_API_FORMATS` fails compilation until it is handled here.
 *
 * Only `openai-compatible` exposes `.chatModel`; the anthropic and google
 * providers are callable instead.
 */
const FORMAT_PROVIDERS: Record<
  ProviderApiFormat,
  (
    endpoint: ProviderEndpoint,
    modelId: string,
    fetchImpl?: FetchFunction,
  ) => LanguageModel
> = {
  "openai-compatible": (endpoint, modelId, fetchImpl) =>
    createOpenAICompatible({
      name: endpoint.name,
      baseURL: endpoint.baseUrl,
      // openai-compatible keeps the key optional so keyless local endpoints
      // stay usable.
      apiKey: endpoint.apiKey.length > 0 ? endpoint.apiKey : undefined,
      includeUsage: true,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }).chatModel(modelId),
  claude: (endpoint, modelId, fetchImpl) =>
    FORMAT_SDK_PROVIDERS.claude(endpoint, fetchImpl)(modelId),
  google: (endpoint, modelId, fetchImpl) =>
    FORMAT_SDK_PROVIDERS.google(endpoint, fetchImpl)(modelId),
};

export function createLanguageModel(
  endpoint: ProviderEndpoint,
  modelId: string,
  options?: { builtinSearch?: boolean },
): LanguageModel {
  const fetchImpl = options?.builtinSearch
    ? withBuiltinWebSearch(endpoint.apiFormat)
    : undefined;
  return FORMAT_PROVIDERS[endpoint.apiFormat](endpoint, modelId, fetchImpl);
}

/**
 * Provider instances that expose a Files API (`.files()`), for reference-based
 * attachment transport. `null` means the format has no Files API at all —
 * `openai-compatible` most of all, whose chat serialization does not even
 * understand provider references.
 */
export type FilesApiProvider =
  | ReturnType<typeof createGoogle>
  | ReturnType<typeof createAnthropic>;

const FORMAT_FILES_APIS: Record<
  ProviderApiFormat,
  ((endpoint: ProviderEndpoint) => FilesApiProvider) | null
> = {
  "openai-compatible": null,
  claude: FORMAT_SDK_PROVIDERS.claude,
  google: FORMAT_SDK_PROVIDERS.google,
};

/**
 * Builds the provider instance the Files API can be taken from, or `null` for
 * formats without one. Exhaustively keyed, so adding a format to
 * `PROVIDER_API_FORMATS` fails compilation until it is decided here.
 */
export function createFilesApi(
  endpoint: ProviderEndpoint,
): FilesApiProvider | null {
  const create = FORMAT_FILES_APIS[endpoint.apiFormat];
  return create ? create(endpoint) : null;
}
