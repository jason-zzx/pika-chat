import "server-only";

export function resolvedMaxOutputTokens(model: {
  outputTokens: number;
  contextTokens: number;
}): number {
  return Math.min(model.outputTokens, model.contextTokens);
}
