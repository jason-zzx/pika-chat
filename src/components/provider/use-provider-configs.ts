"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addProviderModel,
  createProviderConfig,
  deleteProviderConfig,
  discoverProviderModels,
  listProviderConfigs,
  removeProviderModel,
  syncProviderModels,
  updateProviderConfig,
  updateProviderModel,
} from "@/lib/api/provider";
import type {
  AddProviderModelInput,
  CreateProviderConfigInput,
  SyncProviderModelsInput,
  UpdateProviderConfigInput,
  UpdateProviderModelInput,
} from "@/lib/schemas/provider";

import { availableModelKeys } from "./use-available-models";

export const providerConfigKeys = {
  all: ["provider-configs"] as const,
  list: () => [...providerConfigKeys.all, "list"] as const,
};

// Kept outside `providerConfigKeys.all` so model mutations never trigger a
// redundant upstream `/models` call while the dialog closes.
export const providerDiscoveryKeys = {
  all: ["provider-discovery"] as const,
  detail: (configId: string) =>
    [...providerDiscoveryKeys.all, configId] as const,
};

export function useProviderConfigs() {
  return useQuery({
    queryKey: providerConfigKeys.list(),
    queryFn: listProviderConfigs,
  });
}

function useInvalidateProviderQueries() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: providerConfigKeys.all });
    void queryClient.invalidateQueries({ queryKey: availableModelKeys.all });
  };
}

export function useCreateProviderConfig() {
  const invalidate = useInvalidateProviderQueries();
  return useMutation({
    mutationFn: (input: CreateProviderConfigInput) =>
      createProviderConfig(input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateProviderConfig() {
  const invalidate = useInvalidateProviderQueries();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateProviderConfigInput;
    }) => updateProviderConfig(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useDeleteProviderConfig() {
  const invalidate = useInvalidateProviderQueries();
  return useMutation({
    mutationFn: (id: string) => deleteProviderConfig(id),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useDiscoverProviderModels(
  configId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: providerDiscoveryKeys.detail(configId),
    queryFn: () => discoverProviderModels(configId),
    enabled,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useSyncProviderModels() {
  const invalidate = useInvalidateProviderQueries();
  return useMutation({
    mutationFn: ({
      configId,
      input,
    }: {
      configId: string;
      input: SyncProviderModelsInput;
    }) => syncProviderModels(configId, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useAddProviderModel() {
  const invalidate = useInvalidateProviderQueries();
  return useMutation({
    mutationFn: ({
      configId,
      input,
    }: {
      configId: string;
      input: AddProviderModelInput;
    }) => addProviderModel(configId, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useRemoveProviderModel() {
  const invalidate = useInvalidateProviderQueries();
  return useMutation({
    mutationFn: ({
      configId,
      modelId,
    }: {
      configId: string;
      modelId: string;
    }) => removeProviderModel(configId, modelId),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateProviderModel() {
  const invalidate = useInvalidateProviderQueries();
  return useMutation({
    mutationFn: ({
      configId,
      modelId,
      input,
    }: {
      configId: string;
      modelId: string;
      input: UpdateProviderModelInput;
    }) => updateProviderModel(configId, modelId, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}
