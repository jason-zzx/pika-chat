import { z } from "zod";

import { topicSchema } from "./topic";

export const DEFAULT_ASSISTANT_NAME = "Assistant";
export const DEFAULT_ASSISTANT_ICON = "✨";

export const assistantSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  systemPrompt: z.string().nullable(),
  defaultProviderConfigId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  topics: z.array(topicSchema),
});
export type Assistant = z.infer<typeof assistantSchema>;

export const assistantTreeSchema = z.object({
  assistants: z.array(assistantSchema),
});
export type AssistantTree = z.infer<typeof assistantTreeSchema>;

export const createAssistantSchema = z.object({
  name: z.string().trim().min(1),
  icon: z.string().trim().min(1).max(8),
  systemPrompt: z.string().nullable().optional(),
  defaultProviderConfigId: z.string().nullable().optional(),
  defaultModelId: z.string().nullable().optional(),
});
export type CreateAssistantInput = z.infer<typeof createAssistantSchema>;

export const updateAssistantSchema = createAssistantSchema.partial();
export type UpdateAssistantInput = z.infer<typeof updateAssistantSchema>;
