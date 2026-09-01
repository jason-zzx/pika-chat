import { z } from "zod";

export const DEFAULT_TOPIC_TITLE = "New topic";

export const topicSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.coerce.date(),
});
export type Topic = z.infer<typeof topicSchema>;

export const createTopicSchema = z.object({
  assistantId: z.string().min(1),
});
export type CreateTopicInput = z.infer<typeof createTopicSchema>;

export const renameTopicSchema = z.object({
  title: z.string().trim().min(1),
});
export type RenameTopicInput = z.infer<typeof renameTopicSchema>;
