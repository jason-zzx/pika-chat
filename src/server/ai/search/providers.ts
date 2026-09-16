import "server-only";

import { z } from "zod";

import {
  FETCH_CONTENT_LIMIT,
  type FetchPageResult,
  type SearchWebResult,
} from "@/lib/schemas/search-provider";
import type { SearchProvider } from "@/lib/schemas/search-provider";
import type { SearchProviderCredential } from "@/server/services/search-provider.service";

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;

// Brave LLM Context budgets (R10): the endpoint returns pre-extracted page
// chunks per ranked URL, so a single Brave call gives the model real page
// content without a follow-up fetch.
const BRAVE_MAX_URLS = 5;
const BRAVE_MAX_TOKENS = 4096;

const DEFAULT_BASE_URLS: Record<SearchProvider, string> = {
  tavily: "https://api.tavily.com",
  exa: "https://api.exa.ai",
  firecrawl: "https://api.firecrawl.dev",
  brave: "https://api.search.brave.com",
};

export type SearchAdapter = (query: string) => Promise<SearchWebResult[]>;
export type FetchAdapter = (url: string) => Promise<FetchPageResult>;

/** Providers with a URL-fetch capability; brave is excluded (its LLM Context
 * endpoint is query-driven and cannot target a specific URL) — R11. */
export const FETCH_CAPABLE_PROVIDERS = [
  "tavily",
  "exa",
  "firecrawl",
] as const satisfies readonly SearchProvider[];

export function isFetchCapable(provider: SearchProvider): boolean {
  return (FETCH_CAPABLE_PROVIDERS as readonly SearchProvider[]).includes(
    provider,
  );
}

function endpoint(credential: SearchProviderCredential, path: string): string {
  const base = (credential.baseUrl ?? DEFAULT_BASE_URLS[credential.provider])
    .replace(/\/+$/, "");
  return `${base}${path}`;
}

/**
 * Fetches and parses a provider response. Non-2xx, network, timeout, and
 * malformed-payload outcomes all throw so the fallback chain can move on.
 * Error messages carry the provider and status only — upstream bodies may
 * echo request payloads (which can contain the query or the key).
 */
async function fetchJson(
  provider: SearchProvider,
  url: string,
  init: RequestInit,
  operation: "search" | "fetch" = "search",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "network error";
    throw new Error(`${provider} ${operation} request failed (${reason})`);
  }
  if (!response.ok) {
    throw new Error(
      `${provider} ${operation} failed with status ${response.status}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${provider} ${operation} returned a malformed response`);
  }
}

function parseWith<T>(
  provider: SearchProvider,
  schema: z.ZodType<T>,
  payload: unknown,
  operation: "search" | "fetch" = "search",
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`${provider} ${operation} returned an unexpected payload`);
  }
  return parsed.data;
}

// Provider response shapes, verified against current docs. Optional text
// fields degrade to "" so a single sparse result cannot fail the search;
// date fields (tavily published_date, exa publishedDate) pass through when
// present, null/garbage degrades to omitted.
const tavilyResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().catch(""),
      url: z.string(),
      content: z.string().catch(""),
      published_date: z.string().nullish().catch(undefined),
    }),
  ),
});

const exaResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().catch(""),
      url: z.string(),
      text: z.string().catch(""),
      publishedDate: z.string().nullish().catch(undefined),
    }),
  ),
});

const firecrawlResponseSchema = z.object({
  data: z.object({
    web: z
      .array(
        z.object({
          title: z.string().catch(""),
          url: z.string(),
          description: z.string().catch(""),
        }),
      )
      .catch([]),
  }),
});

// Brave LLM Context (R10): `grounding.generic[]` carries pre-extracted page
// chunks per ranked URL; each result's snippet joins its chunks. An empty
// `generic` list is a valid empty answer and does not trigger fallback.
const braveResponseSchema = z.object({
  grounding: z
    .object({
      generic: z
        .array(
          z.object({
            url: z.string(),
            title: z.string().catch(""),
            snippets: z.array(z.string()).catch([]),
          }),
        )
        .catch([]),
    })
    .catch({ generic: [] }),
});

async function searchTavily(
  credential: SearchProviderCredential,
  query: string,
): Promise<SearchWebResult[]> {
  const payload = await fetchJson(
    credential.provider,
    endpoint(credential, "/search"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential.apiKey}`,
      },
      body: JSON.stringify({ query, max_results: MAX_RESULTS }),
    },
  );
  return parseWith(credential.provider, tavilyResponseSchema, payload).results.map(
    (item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content,
      ...(item.published_date ? { publishedDate: item.published_date } : {}),
    }),
  );
}

async function searchExa(
  credential: SearchProviderCredential,
  query: string,
): Promise<SearchWebResult[]> {
  const payload = await fetchJson(
    credential.provider,
    endpoint(credential, "/search"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": credential.apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: MAX_RESULTS,
        contents: { text: { maxCharacters: 500 } },
      }),
    },
  );
  return parseWith(credential.provider, exaResponseSchema, payload).results.map(
    (item) => ({
      title: item.title,
      url: item.url,
      snippet: item.text,
      ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
    }),
  );
}

async function searchFirecrawl(
  credential: SearchProviderCredential,
  query: string,
): Promise<SearchWebResult[]> {
  const payload = await fetchJson(
    credential.provider,
    endpoint(credential, "/v2/search"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential.apiKey}`,
      },
      body: JSON.stringify({ query, limit: MAX_RESULTS }),
    },
  );
  return parseWith(
    credential.provider,
    firecrawlResponseSchema,
    payload,
  ).data.web.map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.description,
  }));
}

async function searchBrave(
  credential: SearchProviderCredential,
  query: string,
): Promise<SearchWebResult[]> {
  const url = new URL(endpoint(credential, "/res/v1/llm/context"));
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("maximum_number_of_urls", String(BRAVE_MAX_URLS));
  url.searchParams.set("maximum_number_of_tokens", String(BRAVE_MAX_TOKENS));
  const payload = await fetchJson(credential.provider, url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-subscription-token": credential.apiKey,
    },
  });
  return parseWith(
    credential.provider,
    braveResponseSchema,
    payload,
  ).grounding.generic.map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippets.join("\n\n"),
  }));
}

const ADAPTER_SEARCH: Record<
  SearchProvider,
  (
    credential: SearchProviderCredential,
    query: string,
  ) => Promise<SearchWebResult[]>
> = {
  tavily: searchTavily,
  exa: searchExa,
  firecrawl: searchFirecrawl,
  brave: searchBrave,
};

export function createSearchAdapter(
  credential: SearchProviderCredential,
): SearchAdapter {
  const search = ADAPTER_SEARCH[credential.provider];
  return (query) => search(credential, query);
}

// --- fetchPage adapters (R11) ---------------------------------------------

/** Cuts page content at FETCH_CONTENT_LIMIT and marks the cut. */
function truncateContent(content: string): {
  content: string;
  truncated: boolean;
} {
  return content.length > FETCH_CONTENT_LIMIT
    ? { content: content.slice(0, FETCH_CONTENT_LIMIT), truncated: true }
    : { content, truncated: false };
}

const tavilyExtractResponseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        raw_content: z.string().catch(""),
      }),
    )
    .catch([]),
  failed_results: z.array(z.object({ url: z.string().catch("") })).catch([]),
});

const exaContentsResponseSchema = z.object({
  results: z.array(
    z.object({
      // Exa echoes the requested URL in `id`; `url` is the canonical
      // (possibly redirected/normalized) URL.
      id: z.string().catch(""),
      title: z.string().catch(""),
      url: z.string(),
      text: z.string().catch(""),
    }),
  ),
});

const firecrawlScrapeResponseSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      markdown: z.string().catch(""),
      metadata: z
        .object({ title: z.string().catch("") })
        .catch({ title: "" }),
    })
    .optional(),
});

async function fetchTavily(
  credential: SearchProviderCredential,
  url: string,
): Promise<FetchPageResult> {
  const payload = await fetchJson(
    credential.provider,
    endpoint(credential, "/extract"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential.apiKey}`,
      },
      body: JSON.stringify({ urls: [url] }),
    },
    "fetch",
  );
  const parsed = parseWith(
    credential.provider,
    tavilyExtractResponseSchema,
    payload,
    "fetch",
  );
  // The URL landing in failed_results counts as a provider failure so the
  // fallback chain advances.
  if (parsed.failed_results.some((failed) => failed.url === url)) {
    throw new Error(`${credential.provider} fetch failed for the requested URL`);
  }
  // When exactly one URL was requested and exactly one result came back,
  // accept it without URL matching — the provider may normalize the URL.
  const result =
    parsed.results.length === 1
      ? parsed.results[0]
      : parsed.results.find((item) => item.url === url);
  if (!result) {
    throw new Error(`${credential.provider} fetch returned no content`);
  }
  return { url: result.url, ...truncateContent(result.raw_content) };
}

async function fetchExa(
  credential: SearchProviderCredential,
  url: string,
): Promise<FetchPageResult> {
  const payload = await fetchJson(
    credential.provider,
    endpoint(credential, "/contents"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": credential.apiKey,
      },
      body: JSON.stringify({
        urls: [url],
        text: { maxCharacters: FETCH_CONTENT_LIMIT },
      }),
    },
    "fetch",
  );
  const parsed = parseWith(
    credential.provider,
    exaContentsResponseSchema,
    payload,
    "fetch",
  );
  // Match by `id` (the requested URL) first — `url` may be canonicalized —
  // and accept a lone result outright when a single URL was requested.
  const result =
    parsed.results.length === 1
      ? parsed.results[0]
      : (parsed.results.find((item) => item.id === url) ??
        parsed.results.find((item) => item.url === url));
  if (!result) {
    throw new Error(`${credential.provider} fetch returned no content`);
  }
  return {
    url: result.url,
    ...(result.title ? { title: result.title } : {}),
    ...truncateContent(result.text),
  };
}

async function fetchFirecrawl(
  credential: SearchProviderCredential,
  url: string,
): Promise<FetchPageResult> {
  const payload = await fetchJson(
    credential.provider,
    endpoint(credential, "/v2/scrape"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential.apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
    },
    "fetch",
  );
  const parsed = parseWith(
    credential.provider,
    firecrawlScrapeResponseSchema,
    payload,
    "fetch",
  );
  if (!parsed.success || !parsed.data) {
    throw new Error(`${credential.provider} fetch failed for the requested URL`);
  }
  const title = parsed.data.metadata.title;
  return {
    url,
    ...(title ? { title } : {}),
    ...truncateContent(parsed.data.markdown),
  };
}

const ADAPTER_FETCH: Partial<
  Record<
    SearchProvider,
    (
      credential: SearchProviderCredential,
      url: string,
    ) => Promise<FetchPageResult>
  >
> = {
  tavily: fetchTavily,
  exa: fetchExa,
  firecrawl: fetchFirecrawl,
};

/** Returns null for providers without a URL-fetch capability (brave). */
export function createFetchAdapter(
  credential: SearchProviderCredential,
): FetchAdapter | null {
  const fetchPage = ADAPTER_FETCH[credential.provider];
  return fetchPage ? (url) => fetchPage(credential, url) : null;
}
