"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addProviderModel,
  createProviderConfig,
  deleteProviderConfig,
  discoverProviderModels,
  listProviderConfigs,
  removeProviderModel,
  updateProviderConfig,
} from "@/lib/api/provider";
import type {
  AddProviderModelInput,
  CreateProviderConfigInput,
  UpdateProviderConfigInput,
} from "@/lib/schemas/provider";

import { availableModelKeys } from "./use-available-models";

export const providerConfigKeys = {
  all: ["provider-configs"] as const,
  list: () => [...providerConfigKeys.all, "list"] as const,
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

export function useDiscoverProviderModels() {
  return useMutation({
    mutationFn: (id: string) => discoverProviderModels(id),
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
