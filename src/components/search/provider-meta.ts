import type { SearchProvider } from "@/lib/schemas/search-provider";

export const SEARCH_PROVIDER_META: Record<
  SearchProvider,
  { label: string; defaultBaseUrl: string }
> = {
  tavily: { label: "Tavily", defaultBaseUrl: "https://api.tavily.com" },
  exa: { label: "Exa", defaultBaseUrl: "https://api.exa.ai" },
  firecrawl: {
    label: "Firecrawl",
    defaultBaseUrl: "https://api.firecrawl.dev",
  },
  brave: {
    label: "Brave Search",
    defaultBaseUrl: "https://api.search.brave.com",
  },
};

export function searchProviderLabel(provider: SearchProvider): string {
  return SEARCH_PROVIDER_META[provider].label;
}
