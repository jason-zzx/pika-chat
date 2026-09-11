/**
 * Endpoint API formats a provider config can speak. The format decides how the
 * server builds the AI SDK provider, how model discovery authenticates and
 * parses, and what the builtin-search fetch wrapper injects — see
 * `.trellis/spec/backend/provider-configs.md`.
 */
export const PROVIDER_API_FORMATS = [
  "openai-compatible",
  "claude",
  "google",
] as const;

export type ProviderApiFormat = (typeof PROVIDER_API_FORMATS)[number];

export const DEFAULT_PROVIDER_API_FORMAT: ProviderApiFormat =
  "openai-compatible";

type ProviderFormatDefaults = {
  /** Filled in when the operator leaves Base URL blank. */
  defaultBaseUrl: string;
  /** Formats whose API rejects keyless calls, so a key must exist. */
  apiKeyRequired: boolean;
};

export const PROVIDER_FORMAT_DEFAULTS: Record<
  ProviderApiFormat,
  ProviderFormatDefaults
> = {
  "openai-compatible": {
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyRequired: false,
  },
  claude: {
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKeyRequired: true,
  },
  google: {
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyRequired: true,
  },
};

export function isProviderApiFormat(
  value: string,
): value is ProviderApiFormat {
  return (PROVIDER_API_FORMATS as readonly string[]).includes(value);
}

export function requiresApiKey(format: ProviderApiFormat): boolean {
  return PROVIDER_FORMAT_DEFAULTS[format].apiKeyRequired;
}
