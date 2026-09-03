export function reasoningEffortRequestValue(
  model: { reasoning: boolean; reasoningOptions: string[] } | undefined,
  effort: string | null,
): string | undefined {
  if (!model?.reasoning || effort === null) {
    return undefined;
  }
  if (!model.reasoningOptions.includes(effort)) {
    return undefined;
  }
  return effort;
}
