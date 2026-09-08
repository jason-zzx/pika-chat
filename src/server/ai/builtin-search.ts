import "server-only";

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

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

/**
 * Wraps the provider fetch to inject `web_search_options: {}` (OpenAI's
 * builtin-search convention) into chat-completions POST bodies. The
 * openai-compatible provider's own providerOptions schema strips unknown
 * keys, so this is the only way the field reaches the wire. Vendors that do
 * not recognize the field ignore it and degrade to a normal completion —
 * accepted, documented behavior.
 *
 * Unparseable bodies and non-chat-completions requests pass through
 * untouched.
 */
export function withBuiltinWebSearch(base?: FetchFunction): FetchFunction {
  const inner = base ?? fetch;
  return (input, init) => {
    if (
      requestMethod(input, init) !== "POST" ||
      !requestUrl(input).includes("/chat/completions") ||
      typeof init?.body !== "string"
    ) {
      return inner(input, init);
    }
    try {
      const parsed: unknown = JSON.parse(init.body);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return inner(input, init);
      }
      return inner(input, {
        ...init,
        body: JSON.stringify({ ...parsed, web_search_options: {} }),
      });
    } catch {
      return inner(input, init);
    }
  };
}
