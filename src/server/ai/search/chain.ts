import "server-only";

import type { SearchProvider } from "@/lib/schemas/search-provider";

export type ChainEntry<I, O> = {
  provider: SearchProvider;
  call: (input: I) => Promise<O>;
};

export type ChainSuccess<O> = {
  provider: SearchProvider;
  value: O;
};

/** Every provider in the chain failed (network / HTTP / auth / timeout). */
export class ChainError extends Error {
  constructor(readonly attemptedProviders: SearchProvider[]) {
    super("All configured providers failed");
    this.name = "ChainError";
  }
}

/**
 * Walks the chain in priority order. The first provider that returns — even
 * with an empty result set — wins; only thrown errors trigger fallback.
 */
export async function runChain<I, O>(
  chain: ChainEntry<I, O>[],
  input: I,
): Promise<ChainSuccess<O>> {
  const attempted: SearchProvider[] = [];
  for (const entry of chain) {
    attempted.push(entry.provider);
    try {
      const value = await entry.call(input);
      return { provider: entry.provider, value };
    } catch {
      // Fall through to the next provider.
    }
  }
  throw new ChainError(attempted);
}
