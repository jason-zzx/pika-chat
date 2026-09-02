import { z } from "zod";

export const DEFAULT_TOPIC_TITLE = "New topic";

export const topicSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Topic = z.infer<typeof topicSchema>;

export const renameTopicSchema = z.object({
  title: z.string().trim().min(1),
});
export type RenameTopicInput = z.infer<typeof renameTopicSchema>;
