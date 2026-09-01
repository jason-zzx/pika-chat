import { z } from "zod";

export const providerVisibilitySchema = z.enum(["private", "shared"]);

export const providerModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

export const ownProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  visibility: providerVisibilitySchema,
  apiKeyLastFour: z.string().nullable(),
  models: z.array(providerModelSchema),
});
export type OwnProviderConfig = z.infer<typeof ownProviderConfigSchema>;

export const sharedProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerName: z.string(),
  models: z.array(providerModelSchema),
});
export type SharedProviderConfig = z.infer<typeof sharedProviderConfigSchema>;

export const providerConfigListSchema = z.object({
  own: z.array(ownProviderConfigSchema),
  shared: z.array(sharedProviderConfigSchema),
});
export type ProviderConfigList = z.infer<typeof providerConfigListSchema>;

export const createProviderConfigSchema = z.object({
  name: z.string().trim().min(1),
  baseUrl: z.url(),
  apiKey: z.string().min(1).nullable().optional(),
  visibility: providerVisibilitySchema.optional().default("private"),
});
export type CreateProviderConfigInput = z.infer<typeof createProviderConfigSchema>;

export const updateProviderConfigSchema = z.object({
  name: z.string().trim().min(1).optional(),
  baseUrl: z.url().optional(),
  apiKey: z.string().min(1).nullable().optional(),
  visibility: providerVisibilitySchema.optional(),
});
export type UpdateProviderConfigInput = z.infer<typeof updateProviderConfigSchema>;

export const addProviderModelSchema = z.object({
  modelId: z.string().trim().min(1),
});
export type AddProviderModelInput = z.infer<typeof addProviderModelSchema>;

export const discoverModelsResponseSchema = z.object({
  modelIds: z.array(z.string()),
});
export type DiscoverModelsResponse = z.infer<typeof discoverModelsResponseSchema>;

export const availableModelSchema = z.object({
  configId: z.string(),
  configName: z.string(),
  modelId: z.string(),
  provenance: z.enum(["own", "shared"]),
  ownerName: z.string().nullable(),
});
export type AvailableModel = z.infer<typeof availableModelSchema>;
