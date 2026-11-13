"use client";

import { useQuery } from "@tanstack/react-query";

import {
  generationKeys,
  listActiveGenerations,
} from "@/lib/api/generation";
import type { GenerationSummary } from "@/lib/schemas/generation";

/**
 * How often an *active* turn is re-checked while the page is visible.
 * Event-driven refreshes (mount, focus, visibility, follow-up actions) do the
 * real work; this only catches a finish that happened while the tab sat idle
 * in the foreground.
 */
export const ACTIVE_GENERATION_POLL_MS = 15_000;

/**
 * The account's still-running generations (chat task §6).
 *
 * Event-driven by default — mount/refocus/visibility/reconnect — and the
 * periodic refresh only runs while at least one turn is actually active and
 * the page is visible, so an idle hidden tab does not poll (AC7).
 */
export function useActiveGenerations(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: generationKeys.active(userId),
    queryFn: listActiveGenerations,
    // No account, no task list: the server scopes every read by userId, and an
    // unscoped key would let one account read another's cached answer ids.
    enabled: enabled && userId !== null,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
    refetchInterval: (current) => {
      const active = current.state.data?.generations.length ?? 0;
      if (active === 0) {
        return false;
      }
      return ACTIVE_GENERATION_POLL_MS;
    },
  });
}

/** The active generation of one topic, if any. */
export function activeGenerationForTopic(
  generations: GenerationSummary[] | undefined,
  topicId: string | undefined,
): GenerationSummary | undefined {
  if (!topicId || !generations) {
    return undefined;
  }
  return generations.find((generation) => generation.topicId === topicId);
}
