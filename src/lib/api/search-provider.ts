import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  searchProviderSettingSchema,
  searchProviderSettingsResponseSchema,
  type ReorderSearchProvidersInput,
  type SearchProvider,
  type SearchProviderSetting,
  type SearchProviderSettingsResponse,
  type UpsertSearchProviderInput,
} from "@/lib/schemas/search-provider";

export async function listSearchProviders(): Promise<SearchProviderSettingsResponse> {
  const response = await fetch("/api/search-providers");
  return parseJson(response, (data) =>
    searchProviderSettingsResponseSchema.parse(data),
  );
}

export async function upsertSearchProvider(
  provider: SearchProvider,
  input: UpsertSearchProviderInput,
): Promise<SearchProviderSetting> {
  const response = await fetch(
    `/api/search-providers/${encodeURIComponent(provider)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return parseJson(response, (data) => searchProviderSettingSchema.parse(data));
}

export async function deleteSearchProvider(
  provider: SearchProvider,
): Promise<void> {
  const response = await fetch(
    `/api/search-providers/${encodeURIComponent(provider)}`,
    { method: "DELETE" },
  );
  await parseEmpty(response);
}

export async function reorderSearchProviders(
  input: ReorderSearchProvidersInput,
): Promise<SearchProviderSettingsResponse> {
  const response = await fetch("/api/search-providers/order", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(response, (data) =>
    searchProviderSettingsResponseSchema.parse(data),
  );
}
