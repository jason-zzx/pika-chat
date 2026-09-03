import type { UIMessage } from "ai";
import { z } from "zod";

export const chatMessageOutcomeSchema = z.enum([
  "completed",
  "stopped",
  "failed",
]);
export type ChatMessageOutcome = z.infer<typeof chatMessageOutcomeSchema>;

export const chatMetadataSchema = z.object({
  outcome: chatMessageOutcomeSchema.optional(),
  errorMessage: z.string().optional(),
  providerConfigId: z.string().optional(),
  modelId: z.string().optional(),
  totalTokens: z.number().optional(),
  finishReason: z.string().optional(),
});
export type ChatMetadata = z.infer<typeof chatMetadataSchema>;

export type ChatDataParts = {
  topic: { topicId: string; streamId: string };
};

export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataParts>;

export const chatTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const chatRequestMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("user"),
  parts: z.array(chatTextPartSchema).min(1),
});

export const chatRequestSchema = z.object({
  assistantId: z.string().min(1),
  topicId: z.string().min(1).optional(),
  providerConfigId: z.string().min(1),
  modelId: z.string().min(1),
  reasoningEffort: z.string().trim().min(1).optional(),
  message: chatRequestMessageSchema,
});
export const stopChatRequestSchema = z.object({
  streamId: z.string().min(1),
});

export const chatStoredPartSchema = z.union([
  chatTextPartSchema,
  z.object({
    type: z.literal("reasoning"),
    text: z.string(),
    id: z.string().optional(),
  }),
  z.object({
    type: z.literal("step-start"),
  }),
]);

export const chatUIMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(chatStoredPartSchema),
  metadata: chatMetadataSchema.optional(),
});

export const chatMessagesResponseSchema = z.object({
  messages: z.array(chatUIMessageSchema),
});
export type ChatMessagesResponse = z.infer<typeof chatMessagesResponseSchema>;
