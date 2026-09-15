import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSearchTools,
  createFetchPageTool,
  createSearchWebTool,
  createSourceNumbering,
} from "@/server/ai/search/tool";
import type { SearchProviderCredential } from "@/server/services/search-provider.service";

function stubFetch(
  handler: (url: string) => Response,
): void {
  const mock = ((input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  vi.stubGlobal("fetch", mock);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const credentials: SearchProviderCredential[] = [
  { provider: "tavily", apiKey: "tavily-key", baseUrl: null },
  { provider: "exa", apiKey: "exa-key", baseUrl: null },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSearchWebTool", () => {
  const searchTool = (creds: SearchProviderCredential[]) =>
    createSearchWebTool(creds, { numbering: createSourceNumbering() });

  it("returns the serving provider and results on success", async () => {
    stubFetch(() =>
      jsonResponse({
        results: [{ title: "A", url: "https://a.example", content: "snippet" }],
      }),
    );
    const searchWeb = searchTool(credentials);

    const output = await searchWeb.execute?.(
      { query: "pika" },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(output).toEqual({
      provider: "tavily",
      query: "pika",
      results: [
        { title: "A", url: "https://a.example", snippet: "snippet", num: 1 },
      ],
    });
  });

  it("falls back to the second provider and reports which one served", async () => {
    stubFetch((url) =>
      url.includes("tavily")
        ? jsonResponse({ error: "unauthorized" }, 401)
        : jsonResponse({
            results: [{ title: "B", url: "https://b.example", text: "text" }],
          }),
    );
    const searchWeb = searchTool(credentials);

    const output = await searchWeb.execute?.(
      { query: "pika" },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(output).toMatchObject({ provider: "exa" });
  });

  it("returns a graceful error output (not a throw) when every provider fails", async () => {
    stubFetch(() => jsonResponse({ error: "down" }, 500));
    const searchWeb = searchTool(credentials);

    const output = await searchWeb.execute?.(
      { query: "pika" },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(output).toEqual({
      error: "search_failed",
      attemptedProviders: ["tavily", "exa"],
    });
  });

  it("returns search_failed without calling any provider when no credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const searchWeb = searchTool([]);

    const output = await searchWeb.execute?.(
      { query: "pika" },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(output).toEqual({ error: "search_failed", attemptedProviders: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createFetchPageTool", () => {
  const fetchTool = (creds: SearchProviderCredential[]) =>
    createFetchPageTool(creds, { numbering: createSourceNumbering() });

  it("returns the serving provider and normalized page content on success", async () => {
    stubFetch(() =>
      jsonResponse({
        results: [
          { url: "https://a.example", raw_content: "full page text" },
        ],
        failed_results: [],
      }),
    );
    const fetchPage = fetchTool(credentials);

    const output = await fetchPage.execute?.(
      { url: "https://a.example" },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(output).toEqual({
      provider: "tavily",
      num: 1,
      url: "https://a.example",
      content: "full page text",
      truncated: false,
    });
  });

  it("skips non-fetch-capable providers (brave) when walking the chain", async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
      () => Promise.resolve(jsonResponse({ error: "down" }, 500)),
    );
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const fetchPage = fetchTool([
      { provider: "brave", apiKey: "brave-key", baseUrl: null },
      { provider: "exa", apiKey: "exa-key", baseUrl: null },
    ]);

    const output = await fetchPage.execute?.(
      { url: "https://a.example" },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(output).toEqual({
      error: "fetch_failed",
      attemptedProviders: ["exa"],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("api.exa.ai");
  });

  it("returns a graceful error output (not a throw) when every provider fails", async () => {
    stubFetch(() => jsonResponse({ error: "down" }, 500));
    const fetchPage = fetchTool(credentials);

    const output = await fetchPage.execute?.(
      { url: "https://a.example" },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(output).toEqual({
      error: "fetch_failed",
      attemptedProviders: ["tavily", "exa"],
    });
  });
});

describe("buildSearchTools", () => {
  it("registers fetchPage when a fetch-capable provider is configured", () => {    const tools = buildSearchTools([
      { provider: "brave", apiKey: "brave-key", baseUrl: null },
      { provider: "tavily", apiKey: "tavily-key", baseUrl: null },
    ]);

    expect(Object.keys(tools).sort()).toEqual(["fetchPage", "searchWeb"]);
  });

  it("omits fetchPage when only brave is configured", () => {
    const tools = buildSearchTools([
      { provider: "brave", apiKey: "brave-key", baseUrl: null },
    ]);

    expect(Object.keys(tools)).toEqual(["searchWeb"]);
  });

  it("points searchWeb at fetchPage in its description only when fetchPage exists", () => {
    const withFetch = buildSearchTools(credentials);
    const braveOnly = buildSearchTools([
      { provider: "brave", apiKey: "brave-key", baseUrl: null },
    ]);

    expect(withFetch.searchWeb?.description).toContain("fetchPage");
    expect(braveOnly.searchWeb?.description).not.toContain("fetchPage");
  });
});

describe("source numbering (R14)", () => {
  const executeOptions = { toolCallId: "call-1", messages: [], context: {} };

  it("numbers served results from one counter shared across both tools", async () => {
    stubFetch((url) =>
      url.includes("/extract")
        ? jsonResponse({
            results: [
              { url: "https://a.example/page", raw_content: "page text" },
            ],
            failed_results: [],
          })
        : jsonResponse({
            results: [
              { title: "A", url: "https://a.example", content: "snippet a" },
              { title: "B", url: "https://b.example", content: "snippet b" },
            ],
          }),
    );
    const tools = buildSearchTools(credentials);

    const firstSearch = await tools.searchWeb?.execute?.(
      { query: "one" },
      executeOptions,
    );
    const fetched = await tools.fetchPage?.execute?.(
      { url: "https://a.example/page" },
      executeOptions,
    );
    const secondSearch = await tools.searchWeb?.execute?.(
      { query: "two" },
      executeOptions,
    );

    // Execution order across both tools within the turn: 1-2 from the first
    // search, 3 from the fetch, 4-5 from the second search — all unique.
    expect(firstSearch).toMatchObject({ results: [{ num: 1 }, { num: 2 }] });
    expect(fetched).toMatchObject({ num: 3 });
    expect(secondSearch).toMatchObject({ results: [{ num: 4 }, { num: 5 }] });
  });

  it("stamps no nums on error outputs", async () => {
    stubFetch(() => jsonResponse({ error: "down" }, 500));
    const tools = buildSearchTools(credentials);

    const searchOutput = await tools.searchWeb?.execute?.(
      { query: "x" },
      executeOptions,
    );
    const fetchOutput = await tools.fetchPage?.execute?.(
      { url: "https://a.example" },
      executeOptions,
    );

    expect(searchOutput).toEqual({
      error: "search_failed",
      attemptedProviders: ["tavily", "exa"],
    });
    expect(fetchOutput).toEqual({
      error: "fetch_failed",
      attemptedProviders: ["tavily", "exa"],
    });
  });
});
