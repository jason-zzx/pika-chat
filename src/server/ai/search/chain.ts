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
 *
 * An aborted turn (explicit stop / deleted topic) must NOT degrade into
 * "try the next provider": the task signal is checked before each attempt and
 * rethrown, so a cancelled generation stops spending provider calls.
 */
export async function runChain<I, O>(
  chain: ChainEntry<I, O>[],
  input: I,
  options: { signal?: AbortSignal } = {},
): Promise<ChainSuccess<O>> {
  const attempted: SearchProvider[] = [];
  for (const entry of chain) {
    options.signal?.throwIfAborted();
    attempted.push(entry.provider);
    try {
      const value = await entry.call(input);
      return { provider: entry.provider, value };
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throw error;
      }
      // Fall through to the next provider.
    }
  }
  throw new ChainError(attempted);
}

/** DOM/undici abort errors, plus the SDK's own AbortError shape. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
