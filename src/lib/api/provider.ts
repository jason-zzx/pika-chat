import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  availableModelSchema,
  discoverModelsResponseSchema,
  ownProviderConfigSchema,
  providerConfigListSchema,
  providerModelSchema,
  type AddProviderModelInput,
  type AvailableModel,
  type CreateProviderConfigInput,
  type DiscoverModelsResponse,
  type OwnProviderConfig,
  type ProviderConfigList,
  type ProviderModel,
  type UpdateProviderConfigInput,
} from "@/lib/schemas/provider";

export async function listProviderConfigs(): Promise<ProviderConfigList> {
  const response = await fetch("/api/providers");
  return parseJson(response, (data) => providerConfigListSchema.parse(data));
}

export async function createProviderConfig(
  input: CreateProviderConfigInput,
): Promise<OwnProviderConfig> {
  const response = await fetch("/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(response, (data) => ownProviderConfigSchema.parse(data));
}

export async function updateProviderConfig(
  id: string,
  input: UpdateProviderConfigInput,
): Promise<OwnProviderConfig> {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(response, (data) => ownProviderConfigSchema.parse(data));
}

export async function deleteProviderConfig(id: string): Promise<void> {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseEmpty(response);
}

export async function discoverProviderModels(
  id: string,
): Promise<DiscoverModelsResponse> {
  const response = await fetch(
    `/api/providers/${encodeURIComponent(id)}/discover`,
    { method: "POST" },
  );
  return parseJson(response, (data) =>
    discoverModelsResponseSchema.parse(data),
  );
}

export async function addProviderModel(
  configId: string,
  input: AddProviderModelInput,
): Promise<ProviderModel> {
  const response = await fetch(
    `/api/providers/${encodeURIComponent(configId)}/models`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return parseJson(response, (data) => providerModelSchema.parse(data));
}

export async function removeProviderModel(
  configId: string,
  modelId: string,
): Promise<void> {
  const params = new URLSearchParams({ modelId });
  const response = await fetch(
    `/api/providers/${encodeURIComponent(configId)}/models?${params}`,
    { method: "DELETE" },
  );
  await parseEmpty(response);
}

export async function listAvailableModels(): Promise<AvailableModel[]> {
  const response = await fetch("/api/models");
  return parseJson(response, (data) =>
    availableModelSchema.array().parse(data),
  );
}
