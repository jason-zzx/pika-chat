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

type ProviderEndpoint = {
  apiFormat: ProviderApiFormat;
  name: string;
  baseUrl: string;
  apiKey: string;
};

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
    createAnthropic({
      baseURL: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    })(modelId),
  google: (endpoint, modelId, fetchImpl) =>
    createGoogle({
      baseURL: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    })(modelId),
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
