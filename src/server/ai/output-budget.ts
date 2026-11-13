import "server-only";

import { getEnv } from "@/server/env";

export function resolvedMaxOutputTokens(
  model: {
    outputTokens: number;
    contextTokens: number;
  },
  isGuest = false,
): number {
  const base = Math.min(model.outputTokens, model.contextTokens);
  return isGuest ? Math.min(base, getEnv().DEMO_MAX_OUTPUT_TOKENS) : base;
}
