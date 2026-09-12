import type { UIMessage } from "ai";
import { z } from "zod";

import {
  fetchPageToolOutputSchema,
  searchModeSchema,
  searchWebToolOutputSchema,
} from "@/lib/schemas/search-provider";

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
  // ISO 8601, message creation time (server-persisted or stream-start).
  createdAt: z.string().optional(),
  // Reasoning phase duration in milliseconds (total across phases).
  reasoningMs: z.number().int().nonnegative().optional(),
  // Per-phase reasoning durations in phase order (multi-step tool turns
  // produce one reasoning phase per step).
  reasoningDurations: z.array(z.number().int().nonnegative()).optional(),
  // Version group the message belongs to (assistant rows only).
  groupId: z.string().optional(),
  // 1-based position of the selected version within its group.
  versionIndex: z.number().int().positive().optional(),
  versionCount: z.number().int().positive().optional(),
  // All version ids in the group, oldest first.
  versionIds: z.array(z.string()).optional(),
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

/**
 * Attachment reference persisted in a user message. Only the canonical
 * `/api/files/<id>` path is accepted — the server re-reads the row and ignores
 * every other client-declared field, so a forged url or mediaType cannot make
 * it route an arbitrary payload to the model.
 */
export const chatFilePartSchema = z.object({
  type: z.literal("file"),
  url: z.string().regex(/^\/api\/files\/[\w-]+$/),
  mediaType: z.string().min(1),
  filename: z.string().min(1).optional(),
  // Stamped server-side from the stored row so attachment cards can show the
  // size; optional to stay compatible with messages persisted before it.
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type ChatFilePart = z.infer<typeof chatFilePartSchema>;

export const chatRequestPartSchema = z.union([
  chatTextPartSchema,
  chatFilePartSchema,
]);
export type ChatRequestPart = z.infer<typeof chatRequestPartSchema>;

export const chatRequestMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("user"),
  // `.min(1)` still holds for an attachment-only message: the file part is a
  // part. PRD R4 allows sending attachments with no text.
  parts: z.array(chatRequestPartSchema).min(1),
});

export const chatRequestSchema = z.object({
  assistantId: z.string().min(1),
  topicId: z.string().min(1).optional(),
  providerConfigId: z.string().min(1),
  modelId: z.string().min(1),
  reasoningEffort: z.string().trim().min(1).optional(),
  searchMode: searchModeSchema.optional(),
  message: chatRequestMessageSchema,
});
export const stopChatRequestSchema = z.object({
  streamId: z.string().min(1),
});

export const regenerateMessageRequestSchema = z.object({
  providerConfigId: z.string().min(1),
  modelId: z.string().min(1),
  reasoningEffort: z.string().trim().min(1).optional(),
  searchMode: searchModeSchema.optional(),
});

// Persisted shape of a tool invocation (searchWeb / fetchPage). Mirrors the
// AI SDK's static ToolUIPart states minus approval variants (the tools never
// request approval); discriminated by `state` so the inferred type stays
// assignable to the SDK's per-state part union. `input` is partial because
// `input-streaming` parts carry an incrementally parsed query/url.
const searchWebToolInputPartSchema = z.object({ query: z.string().optional() });

/** Shared state-discriminated tool-part builder for a one-input-field tool. */
function toolPartSchema<
  TType extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(
  type: TType,
  inputSchema: TInput,
  outputSchema: TOutput,
) {
  return z.discriminatedUnion("state", [
    z.object({
      type: z.literal(type),
      toolCallId: z.string(),
      state: z.literal("input-streaming"),
      input: inputSchema.optional(),
    }),
    z.object({
      type: z.literal(type),
      toolCallId: z.string(),
      state: z.literal("input-available"),
      input: inputSchema,
    }),
    z.object({
      type: z.literal(type),
      toolCallId: z.string(),
      state: z.literal("output-available"),
      input: inputSchema,
      output: outputSchema,
    }),
    z.object({
      type: z.literal(type),
      toolCallId: z.string(),
      state: z.literal("output-error"),
      input: inputSchema,
      errorText: z.string(),
    }),
  ]);
}

const chatToolSearchWebPartSchema = toolPartSchema(
  "tool-searchWeb",
  searchWebToolInputPartSchema,
  searchWebToolOutputSchema,
);
const fetchPageToolInputPartSchema = z.object({ url: z.string().optional() });
const chatToolFetchPagePartSchema = toolPartSchema(
  "tool-fetchPage",
  fetchPageToolInputPartSchema,
  fetchPageToolOutputSchema,
);

export const chatStoredPartSchema = z.union([
  chatTextPartSchema,
  chatFilePartSchema,
  z.object({
    type: z.literal("reasoning"),
    text: z.string(),
    id: z.string().optional(),
    // Per-phase thinking duration in ms, zipped in at persistence time so
    // reloaded history shows the same per-step durations the live stream
    // announced (no dedicated column needed).
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("step-start"),
  }),
  chatToolSearchWebPartSchema,
  chatToolFetchPagePartSchema,
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
