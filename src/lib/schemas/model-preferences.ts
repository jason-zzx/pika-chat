import { z } from "zod";

/** One model pick: a provider config plus one of its models. */
export const modelPairSchema = z.object({
  providerConfigId: z.string().min(1),
  modelId: z.string().min(1),
});
export type ModelPair = z.infer<typeof modelPairSchema>;

/**
 * Per-user default model preferences, stored as one jsonb column on `users`.
 * Each slot is independently settable; `null` clears a slot. Read back with
 * `parseModelPreferences` so dirty data degrades to empty preferences.
 */
export const modelPreferencesSchema = z.object({
  chat: modelPairSchema.nullish(),
  title: modelPairSchema.nullish(),
  compression: modelPairSchema.nullish(),
  translation: modelPairSchema.nullish(),
});
export type ModelPreferences = z.infer<typeof modelPreferencesSchema>;
export type ModelPreferencePurpose = keyof ModelPreferences;

/** Collapses an optional pair (both fields or neither) to a ModelPair|null. */
export function pairOrNull(input: {
  providerConfigId?: string;
  modelId?: string;
}): ModelPair | null {
  return input.providerConfigId && input.modelId
    ? { providerConfigId: input.providerConfigId, modelId: input.modelId }
    : null;
}

/** Dirty jsonb (manually edited, or a future-removed shape) → empty prefs. */
export function parseModelPreferences(raw: unknown): ModelPreferences {
  const parsed = modelPreferencesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}
