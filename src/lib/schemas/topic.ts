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

export const generateTopicTitleSchema = z.object({
  providerConfigId: z.string().min(1),
  modelId: z.string().min(1),
});
export type GenerateTopicTitleInput = z.infer<typeof generateTopicTitleSchema>;
