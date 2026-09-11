import "server-only";

import type { ProviderApiFormat } from "@/lib/provider-format";

export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type JsonObject = { [key: string]: unknown };

/** Anthropic caps server-side web searches per request. */
const ANTHROPIC_WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
} as const;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/**
 * Appends to an existing `tools` array rather than replacing it, so a caller
 * that registered function tools does not lose them to the search injection.
 */
function appendTools(body: JsonObject, tools: readonly unknown[]): JsonObject {
  const existing: unknown[] = Array.isArray(body.tools) ? body.tools : [];
  return { ...body, tools: [...existing, ...tools] };
}

type Injection = {
  /** `url` is already lowercased. */
  matches: (url: string) => boolean;
  apply: (body: JsonObject) => JsonObject;
};

const FORMAT_INJECTION: Record<ProviderApiFormat, Injection> = {
  "openai-compatible": {
    matches: (url) => url.includes("/chat/completions"),
    apply: (body) => ({ ...body, web_search_options: {} }),
  },
  claude: {
    matches: (url) => url.endsWith("/messages"),
    apply: (body) => appendTools(body, [ANTHROPIC_WEB_SEARCH_TOOL]),
  },
  google: {
    // Matches both `:generateContent` and `:streamGenerateContent` — the SDK
    // streams, so the latter is the one that actually shows up.
    matches: (url) => url.includes("generatecontent"),
    apply: (body) => appendTools(body, [{ googleSearch: {} }]),
  },
};

/**
 * Wraps the provider fetch to inject the format's builtin-search marker into
 * request bodies:
 *
 * - openai-compatible: `web_search_options: {}`, OpenAI's convention. The
 *   openai-compatible provider's own providerOptions schema strips unknown
 *   keys, so this is the only way the field reaches the wire.
 * - claude: the `web_search_20250305` server tool, appended to `tools`.
 * - google: the `googleSearch` grounding tool, appended to `tools`.
 *
 * Vendors that do not recognize the injected field ignore it and degrade to a
 * normal completion — accepted, documented behavior.
 *
 * URL mismatches, unparseable bodies and non-object bodies pass through
 * untouched.
 */
export function withBuiltinWebSearch(
  format: ProviderApiFormat,
  base?: FetchFunction,
): FetchFunction {
  const inner = base ?? fetch;
  const injection = FORMAT_INJECTION[format];
  return (input, init) => {
    if (
      requestMethod(input, init) !== "POST" ||
      !injection.matches(requestUrl(input).toLowerCase()) ||
      typeof init?.body !== "string"
    ) {
      return inner(input, init);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      return inner(input, init);
    }
    if (!isJsonObject(parsed)) {
      return inner(input, init);
    }
    return inner(input, {
      ...init,
      body: JSON.stringify(injection.apply(parsed)),
    });
  };
}
