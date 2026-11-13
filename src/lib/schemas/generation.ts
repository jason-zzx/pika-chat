import { z } from "zod";

/**
 * Wire shape of a server-managed generation (chat task R1/R3/R5).
 *
 * The generation row is the authoritative task identity: the browser only
 * mirrors it for discovery ("is this topic still generating?") and for the
 * stop endpoint. Message content never travels through these payloads — the
 * live content comes from the SSE stream, the final content from history.
 */

export const generationKindSchema = z.enum(["send", "regenerate", "edit"]);
export type GenerationKind = z.infer<typeof generationKindSchema>;

export const generationStatusSchema = z.enum([
  "queued",
  "running",
  "stopping",
  "completed",
  "stopped",
  "failed",
  "interrupted",
]);
export type GenerationStatus = z.infer<typeof generationStatusSchema>;

/** Statuses that still own a topic's turn. */
export const ACTIVE_GENERATION_STATUSES = [
  "queued",
  "running",
  "stopping",
] as const satisfies readonly GenerationStatus[];

export function isActiveGenerationStatus(
  status: GenerationStatus,
): boolean {
  return (ACTIVE_GENERATION_STATUSES as readonly GenerationStatus[]).includes(
    status,
  );
}

export const generationSummarySchema = z.object({
  id: z.string(),
  /** Null once the target topic was deleted (late output is discarded). */
  topicId: z.string().nullable(),
  assistantId: z.string().nullable(),
  assistantMessageId: z.string().nullable(),
  kind: generationKindSchema,
  status: generationStatusSchema,
  targetDeleted: z.boolean(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type GenerationSummary = z.infer<typeof generationSummarySchema>;

export const generationsResponseSchema = z.object({
  generations: z.array(generationSummarySchema),
});
export type GenerationsResponse = z.infer<typeof generationsResponseSchema>;

export const generationResponseSchema = z.object({
  generation: generationSummarySchema,
});
export type GenerationResponse = z.infer<typeof generationResponseSchema>;
