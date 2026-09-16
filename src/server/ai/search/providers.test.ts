import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchAdapter, createSearchAdapter } from "@/server/ai/search/providers";
import type { SearchProviderCredential } from "@/server/services/search-provider.service";

type FetchCall = { url: string; init?: RequestInit };

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response,
): FetchCall[] {
  const calls: FetchCall[] = [];
  const mock = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  vi.stubGlobal("fetch", mock);
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function credential(
  overrides: Partial<SearchProviderCredential> = {},
): SearchProviderCredential {
  return { provider: "tavily", apiKey: "test-key", baseUrl: null, ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tavily adapter", () => {
  it("posts to /search with a bearer token and normalizes results", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        results: [
          {
            title: "Result A",
            url: "https://a.example",
            content: "Snippet A",
            published_date: "2026-09-10",
          },
          { title: "Result B", url: "https://b.example", content: "Snippet B" },
        ],
      }),
    );
    const search = createSearchAdapter(credential());
    const results = await search("pika chat");

    expect(results).toEqual([
      {
        title: "Result A",
        url: "https://a.example",
        snippet: "Snippet A",
        publishedDate: "2026-09-10",
      },
      { title: "Result B", url: "https://b.example", snippet: "Snippet B" },
    ]);
    const call = calls[0];
    expect(call?.url).toBe("https://api.tavily.com/search");
    expect(call?.init?.method).toBe("POST");
    expect(
      new Headers(call?.init?.headers).get("authorization"),
    ).toBe("Bearer test-key");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      query: "pika chat",
      max_results: 5,
    });
  });
});

describe("exa adapter", () => {
  it("posts to /search with an x-api-key header and maps text to snippet", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        results: [
          {
            title: "Exa",
            url: "https://exa.example",
            text: "Exa text",
            publishedDate: "2026-09-14T08:00:00.000Z",
          },
          {
            title: "Undated",
            url: "https://exa.example/old",
            text: "no date",
            publishedDate: null,
          },
        ],
      }),
    );
    const search = createSearchAdapter(credential({ provider: "exa", apiKey: "exa-key" }));
    const results = await search("query");

    expect(results).toEqual([
      {
        title: "Exa",
        url: "https://exa.example",
        snippet: "Exa text",
        publishedDate: "2026-09-14T08:00:00.000Z",
      },
      { title: "Undated", url: "https://exa.example/old", snippet: "no date" },
    ]);
    // A null publishedDate is omitted rather than passed through as null.
    expect(results[1]).not.toHaveProperty("publishedDate");
    const call = calls[0];
    expect(call?.url).toBe("https://api.exa.ai/search");
    expect(new Headers(call?.init?.headers).get("x-api-key")).toBe("exa-key");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      query: "query",
      numResults: 5,
      contents: { text: { maxCharacters: 500 } },
    });
  });
});

describe("firecrawl adapter", () => {
  it("posts to /v2/search and reads data.web", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        success: true,
        data: {
          web: [
            {
              title: "FC",
              url: "https://fc.example",
              description: "FC description",
            },
          ],
        },
      }),
    );
    const search = createSearchAdapter(
      credential({ provider: "firecrawl", apiKey: "fc-key" }),
    );
    const results = await search("query");

    expect(results).toEqual([
      { title: "FC", url: "https://fc.example", snippet: "FC description" },
    ]);
    const call = calls[0];
    expect(call?.url).toBe("https://api.firecrawl.dev/v2/search");
    expect(
      new Headers(call?.init?.headers).get("authorization"),
    ).toBe("Bearer fc-key");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      query: "query",
      limit: 5,
    });
  });
});

describe("brave adapter", () => {
  it("gets /res/v1/llm/context with token budgets and joins extracted chunks", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        grounding: {
          generic: [
            {
              url: "https://brave.example/a",
              title: "Brave A",
              snippets: ["chunk one", "chunk two"],
            },
            {
              url: "https://brave.example/b",
              title: "Brave B",
              snippets: ["single chunk"],
            },
          ],
        },
        sources: {
          "https://brave.example/a": { title: "Brave A" },
        },
      }),
    );
    const search = createSearchAdapter(
      credential({ provider: "brave", apiKey: "brave-key" }),
    );
    const results = await search("pika chat");

    expect(results).toEqual([
      {
        title: "Brave A",
        url: "https://brave.example/a",
        snippet: "chunk one\n\nchunk two",
      },
      {
        title: "Brave B",
        url: "https://brave.example/b",
        snippet: "single chunk",
      },
    ]);
    const call = calls[0];
    const url = new URL(String(call?.url));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api.search.brave.com/res/v1/llm/context",
    );
    expect(url.searchParams.get("q")).toBe("pika chat");
    expect(url.searchParams.get("count")).toBe("5");
    expect(url.searchParams.get("maximum_number_of_urls")).toBe("5");
    expect(url.searchParams.get("maximum_number_of_tokens")).toBe("4096");
    expect(call?.init?.method).toBe("GET");
    expect(
      new Headers(call?.init?.headers).get("x-subscription-token"),
    ).toBe("brave-key");
  });

  it("treats an empty grounding.generic list as a valid empty answer", async () => {
    stubFetch(() => jsonResponse({ grounding: { generic: [] } }));
    const search = createSearchAdapter(
      credential({ provider: "brave", apiKey: "brave-key" }),
    );
    await expect(search("obscure query")).resolves.toEqual([]);
  });

  it("has no fetch adapter (no URL-fetch endpoint)", () => {
    expect(
      createFetchAdapter(credential({ provider: "brave" })),
    ).toBeNull();
  });
});

describe("shared adapter behavior", () => {
  it("honors a custom base URL, trimming trailing slashes", async () => {
    const calls = stubFetch(() => jsonResponse({ results: [] }));
    const search = createSearchAdapter(
      credential({ baseUrl: "https://proxy.example.com/" }),
    );
    await search("query");
    expect(calls[0]?.url).toBe("https://proxy.example.com/search");
  });

  it("throws on non-2xx responses", async () => {
    stubFetch(() => jsonResponse({ error: "nope" }, 401));
    const search = createSearchAdapter(credential());
    await expect(search("query")).rejects.toThrow(/401/);
  });

  it("throws on network errors", async () => {
    const mock = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    vi.stubGlobal("fetch", mock);
    const search = createSearchAdapter(credential());
    await expect(search("query")).rejects.toThrow(/tavily/);
  });

  it("throws on malformed JSON", async () => {
    stubFetch(
      () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const search = createSearchAdapter(credential());
    await expect(search("query")).rejects.toThrow(/malformed/);
  });

  it("throws on an unexpected payload shape", async () => {
    stubFetch(() => jsonResponse({ results: "not-an-array" }));
    const search = createSearchAdapter(credential());
    await expect(search("query")).rejects.toThrow(/unexpected payload/);
  });

  it("tolerates sparse results by defaulting missing text fields", async () => {
    stubFetch(() => jsonResponse({ results: [{ url: "https://a.example" }] }));
    const search = createSearchAdapter(credential());
    await expect(search("query")).resolves.toEqual([
      { title: "", url: "https://a.example", snippet: "" },
    ]);
  });
});

describe("tavily fetch adapter", () => {
  it("posts to /extract and returns raw_content for the requested URL", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        results: [
          { url: "https://a.example", raw_content: "full page text" },
        ],
        failed_results: [],
      }),
    );
    const fetchPage = createFetchAdapter(credential());
    expect(fetchPage).not.toBeNull();
    const result = await fetchPage?.("https://a.example");

    expect(result).toEqual({
      url: "https://a.example",
      content: "full page text",
      truncated: false,
    });
    const call = calls[0];
    expect(call?.url).toBe("https://api.tavily.com/extract");
    expect(
      new Headers(call?.init?.headers).get("authorization"),
    ).toBe("Bearer test-key");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      urls: ["https://a.example"],
    });
  });

  it("throws when the URL lands in failed_results", async () => {
    stubFetch(() =>
      jsonResponse({
        results: [],
        failed_results: [
          { url: "https://a.example", error: "unreachable" },
        ],
      }),
    );
    const fetchPage = createFetchAdapter(credential());
    await expect(fetchPage?.("https://a.example")).rejects.toThrow(/tavily/);
  });

  it("throws when no result matches the requested URL", async () => {
    stubFetch(() => jsonResponse({ results: [], failed_results: [] }));
    const fetchPage = createFetchAdapter(credential());
    await expect(fetchPage?.("https://a.example")).rejects.toThrow(
      /no content/,
    );
  });

  it("accepts a lone result without URL matching (normalized URL)", async () => {
    stubFetch(() =>
      jsonResponse({
        results: [
          { url: "https://a.example/canonical", raw_content: "page text" },
        ],
        failed_results: [],
      }),
    );
    const fetchPage = createFetchAdapter(credential());
    const result = await fetchPage?.("https://a.example/original");
    expect(result).toEqual({
      url: "https://a.example/canonical",
      content: "page text",
      truncated: false,
    });
  });
});

describe("exa fetch adapter", () => {
  it("posts to /contents with an 8000-char budget and maps title and text", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        results: [
          {
            title: "Exa Page",
            url: "https://exa.example/page",
            text: "exa page text",
          },
        ],
      }),
    );
    const fetchPage = createFetchAdapter(
      credential({ provider: "exa", apiKey: "exa-key" }),
    );
    const result = await fetchPage?.("https://exa.example/page");

    expect(result).toEqual({
      url: "https://exa.example/page",
      title: "Exa Page",
      content: "exa page text",
      truncated: false,
    });
    const call = calls[0];
    expect(call?.url).toBe("https://api.exa.ai/contents");
    expect(new Headers(call?.init?.headers).get("x-api-key")).toBe("exa-key");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      urls: ["https://exa.example/page"],
      text: { maxCharacters: 8000 },
    });
  });

  it("omits the title when the response title is empty", async () => {
    stubFetch(() =>
      jsonResponse({
        results: [{ title: "", url: "https://exa.example/p", text: "text" }],
      }),
    );
    const fetchPage = createFetchAdapter(
      credential({ provider: "exa", apiKey: "exa-key" }),
    );
    const result = await fetchPage?.("https://exa.example/p");
    expect(result).toEqual({
      url: "https://exa.example/p",
      content: "text",
      truncated: false,
    });
  });

  it("matches a canonicalized result URL via the echoed id field", async () => {
    stubFetch(() =>
      jsonResponse({
        results: [
          {
            id: "https://exa.example/original",
            title: "Canon",
            url: "https://exa.example/canonical",
            text: "canonical text",
          },
          {
            id: "https://exa.example/other",
            title: "Other",
            url: "https://exa.example/other",
            text: "other text",
          },
        ],
      }),
    );
    const fetchPage = createFetchAdapter(
      credential({ provider: "exa", apiKey: "exa-key" }),
    );
    const result = await fetchPage?.("https://exa.example/original");
    expect(result).toEqual({
      url: "https://exa.example/canonical",
      title: "Canon",
      content: "canonical text",
      truncated: false,
    });
  });
});

describe("firecrawl fetch adapter", () => {
  it("posts to /v2/scrape and maps markdown plus the metadata title", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        success: true,
        data: {
          markdown: "# scraped",
          metadata: { title: "Scraped Title" },
        },
      }),
    );
    const fetchPage = createFetchAdapter(
      credential({ provider: "firecrawl", apiKey: "fc-key" }),
    );
    const result = await fetchPage?.("https://fc.example");

    expect(result).toEqual({
      url: "https://fc.example",
      title: "Scraped Title",
      content: "# scraped",
      truncated: false,
    });
    const call = calls[0];
    expect(call?.url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      url: "https://fc.example",
      formats: ["markdown"],
    });
  });

  it("throws when success is false", async () => {
    stubFetch(() => jsonResponse({ success: false }));
    const fetchPage = createFetchAdapter(
      credential({ provider: "firecrawl", apiKey: "fc-key" }),
    );
    await expect(fetchPage?.("https://fc.example")).rejects.toThrow(
      /firecrawl/,
    );
  });
});

describe("fetch content truncation", () => {
  it("caps content at 8000 chars and flags the cut", async () => {
    const long = "x".repeat(9000);
    stubFetch(() =>
      jsonResponse({
        results: [{ url: "https://a.example", raw_content: long }],
        failed_results: [],
      }),
    );
    const fetchPage = createFetchAdapter(credential());
    const result = await fetchPage?.("https://a.example");

    expect(result?.truncated).toBe(true);
    expect(result?.content).toHaveLength(8000);
  });
});
