import type { GenerationSummary } from "@/lib/schemas/generation";

/** A running generation of topic t1, as the discovery query reports it. */
export function generationSummary(
  overrides: Partial<GenerationSummary> = {},
): GenerationSummary {
  const now = new Date().toISOString();
  return {
    id: "gen-9",
    topicId: "t1",
    assistantId: "a1",
    assistantMessageId: "srv-a2",
    kind: "send",
    status: "running",
    targetDeleted: false,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
    ...overrides,
  };
}
