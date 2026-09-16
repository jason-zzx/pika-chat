import { MODEL_VENDOR_KEYS } from "@/lib/model-vendor";
import {
  DEFAULT_PROVIDER_API_FORMAT,
  PROVIDER_API_FORMATS,
} from "@/lib/provider-format";
import { z } from "zod";

export const providerVisibilitySchema = z.enum(["private", "shared"]);

export const providerApiFormatSchema = z.enum(PROVIDER_API_FORMATS);

export const modelMetadataSourceSchema = z.enum([
  "catalog",
  "default",
  "user",
]);
export type ModelMetadataSource = z.infer<typeof modelMetadataSourceSchema>;

export const DEFAULT_MODEL_CONTEXT_TOKENS = 256_000;
export const DEFAULT_MODEL_OUTPUT_TOKENS = 65_536;
export const REASONING_EFFORT_CHOICES = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffortChoice = (typeof REASONING_EFFORT_CHOICES)[number];
export const SEEDED_REASONING_OPTIONS = ["low", "medium", "high"] as const;

export function isReasoningEffortChoice(
  value: string,
): value is ReasoningEffortChoice {
  return (REASONING_EFFORT_CHOICES as readonly string[]).includes(value);
}

export const modelMetadataFieldsSchema = z.object({
  contextTokens: z.number().int().positive(),
  outputTokens: z.number().int().positive(),
  inputModalities: z.array(z.string()),
  outputModalities: z.array(z.string()),
  reasoning: z.boolean(),
  reasoningOptions: z.array(z.string()),
  vendorKey: z.string().nullable(),
  metadataSource: modelMetadataSourceSchema,
});
export type ModelMetadataFields = z.infer<typeof modelMetadataFieldsSchema>;

export function defaultModelMetadata(
  overrides: Partial<ModelMetadataFields> = {},
): ModelMetadataFields {
  return {
    contextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
    outputTokens: DEFAULT_MODEL_OUTPUT_TOKENS,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    reasoningOptions: [],
    vendorKey: null,
    metadataSource: "default",
    ...overrides,
  };
}

export const providerModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  ...modelMetadataFieldsSchema.shape,
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

export const ownProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  apiFormat: providerApiFormatSchema,
  visibility: providerVisibilitySchema,
  enabled: z.boolean(),
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
  apiFormat: providerApiFormatSchema.default(DEFAULT_PROVIDER_API_FORMAT),
  visibility: providerVisibilitySchema.optional().default("private"),
});
export type CreateProviderConfigInput = z.infer<typeof createProviderConfigSchema>;

export const updateProviderConfigSchema = z.object({
  name: z.string().trim().min(1).optional(),
  baseUrl: z.url().optional(),
  apiKey: z.string().min(1).nullable().optional(),
  apiFormat: providerApiFormatSchema.optional(),
  visibility: providerVisibilitySchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateProviderConfigInput = z.infer<typeof updateProviderConfigSchema>;

export const updateProviderModelSchema = z.object({
  contextTokens: z.number().int().positive().optional(),
  outputTokens: z.number().int().positive().optional(),
  inputModalities: z.array(z.string().trim().min(1)).min(1).optional(),
  outputModalities: z.array(z.string().trim().min(1)).min(1).optional(),
  reasoning: z.boolean().optional(),
  reasoningOptions: z.array(z.string().trim().min(1)).optional(),
  vendorKey: z.enum(MODEL_VENDOR_KEYS).nullable().optional(),
  resetFromCatalog: z.boolean().optional(),
});
export type UpdateProviderModelInput = z.infer<typeof updateProviderModelSchema>;

// Optional metadata fields are explicit overrides applied on top of the
// catalog fill, so an add dialog only sends the fields the user touched.
export const addProviderModelSchema = z
  .object({
    modelId: z.string().trim().min(1),
  })
  .merge(updateProviderModelSchema.omit({ resetFromCatalog: true }));
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
  ...modelMetadataFieldsSchema.shape,
});
export type AvailableModel = z.infer<typeof availableModelSchema>;
