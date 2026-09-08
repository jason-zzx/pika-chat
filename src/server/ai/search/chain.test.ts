import { describe, expect, it, vi } from "vitest";

import type { SearchWebResult } from "@/lib/schemas/search-provider";
import type { FetchPageResult } from "@/lib/schemas/search-provider";
import { ChainError, runChain } from "@/server/ai/search/chain";
import type { ChainEntry } from "@/server/ai/search/chain";

function searchEntry(
  provider: ChainEntry<string, SearchWebResult[]>["provider"],
  call: ChainEntry<string, SearchWebResult[]>["call"],
): ChainEntry<string, SearchWebResult[]> {
  return { provider, call };
}

describe("runChain (search)", () => {
  it("returns the first provider's results without calling the next", async () => {
    const second = vi.fn();
    const chain = [
      searchEntry("tavily", async () => [
        { title: "A", url: "https://a.example", snippet: "a" },
      ]),
      searchEntry("exa", second),
    ];

    const outcome = await runChain(chain, "query");

    expect(outcome.provider).toBe("tavily");
    expect(outcome.value).toHaveLength(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("falls back to the next provider when the first throws", async () => {
    const chain = [
      searchEntry("tavily", async () => {
        throw new Error("tavily search failed with status 401");
      }),
      searchEntry("exa", async () => [
        { title: "B", url: "https://b.example", snippet: "b" },
      ]),
    ];

    const outcome = await runChain(chain, "query");

    expect(outcome.provider).toBe("exa");
    expect(outcome.value[0]?.title).toBe("B");
  });

  it("treats an empty result set as success — no fallback", async () => {
    const second = vi.fn();
    const chain = [searchEntry("tavily", async () => []), searchEntry("exa", second)];

    const outcome = await runChain(chain, "query");

    expect(outcome).toEqual({ provider: "tavily", value: [] });
    expect(second).not.toHaveBeenCalled();
  });

  it("throws ChainError with attempted providers when all fail", async () => {
    const chain = [
      searchEntry("tavily", async () => {
        throw new Error("boom");
      }),
      searchEntry("exa", async () => {
        throw new Error("boom");
      }),
    ];

    const failure = await runChain(chain, "query").catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ChainError);
    expect((failure as ChainError).attemptedProviders).toEqual([
      "tavily",
      "exa",
    ]);
  });

  it("throws ChainError with no attempts for an empty chain", async () => {
    await expect(
      runChain<string, SearchWebResult[]>([], "query"),
    ).rejects.toMatchObject({
      name: "ChainError",
      attemptedProviders: [],
    });
  });
});

describe("runChain (fetch)", () => {
  function fetchEntry(
    provider: ChainEntry<string, FetchPageResult>["provider"],
    call: ChainEntry<string, FetchPageResult>["call"],
  ): ChainEntry<string, FetchPageResult> {
    return { provider, call };
  }

  it("returns the first provider's page without calling the next", async () => {
    const second = vi.fn();
    const chain = [
      fetchEntry("tavily", async (url) => ({
        url,
        content: "page text",
        truncated: false,
      })),
      fetchEntry("exa", second),
    ];

    const outcome = await runChain(chain, "https://a.example");

    expect(outcome.provider).toBe("tavily");
    expect(outcome.value.content).toBe("page text");
    expect(second).not.toHaveBeenCalled();
  });

  it("falls back to the next fetch-capable provider when the first throws", async () => {
    const chain = [
      fetchEntry("tavily", async () => {
        throw new Error("tavily fetch failed with status 401");
      }),
      fetchEntry("firecrawl", async (url) => ({
        url,
        title: "FC",
        content: "scraped",
        truncated: false,
      })),
    ];

    const outcome = await runChain(chain, "https://a.example");

    expect(outcome.provider).toBe("firecrawl");
    expect(outcome.value.title).toBe("FC");
  });

  it("throws ChainError with attempted providers when all fail", async () => {
    const chain = [
      fetchEntry("tavily", async () => {
        throw new Error("boom");
      }),
      fetchEntry("exa", async () => {
        throw new Error("boom");
      }),
    ];

    const failure = await runChain(chain, "https://a.example").catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ChainError);
    expect((failure as ChainError).attemptedProviders).toEqual([
      "tavily",
      "exa",
    ]);
  });
});
