import { z } from "zod";

export const topicSchema = z.object({
  id: z.string(),
  title: z.string(),
  isFavorite: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Topic = z.infer<typeof topicSchema>;

export const setTopicFavoriteSchema = z.object({
  favorite: z.boolean(),
});
export type SetTopicFavoriteInput = z.infer<typeof setTopicFavoriteSchema>;

export const renameTopicSchema = z.object({
  title: z.string().trim().min(1),
});
export type RenameTopicInput = z.infer<typeof renameTopicSchema>;

/** Topic detail (GET /api/topics/[id]): the shared projection plus the
 * history-compression boundary, which the message list needs to render the
 * "earlier conversation compressed" marker. */
export const topicDetailSchema = topicSchema.extend({
  summaryUpToMessageId: z.string().nullable(),
  summaryUpToGroupId: z.string().nullable(),
  summaryText: z.string().nullable(),
});
export type TopicDetail = z.infer<typeof topicDetailSchema>;

/** Manual compression: the pair is optional — the server falls back to the
 * caller's `compression` model preference, then 400s when neither exists. */
export const compressTopicSchema = z.object({
  providerConfigId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});
export type CompressTopicInput = z.infer<typeof compressTopicSchema>;

/** Title generation: the pair is optional — the server prefers the caller's
 * `title` model preference and falls back to the truncated-text title when
 * neither is set. */
export const generateTopicTitleSchema = z.object({
  providerConfigId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});
export type GenerateTopicTitleInput = z.infer<typeof generateTopicTitleSchema>;
