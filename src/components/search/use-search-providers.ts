"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteSearchProvider,
  listSearchProviders,
  reorderSearchProviders,
  upsertSearchProvider,
} from "@/lib/api/search-provider";
import type {
  ReorderSearchProvidersInput,
  SearchProvider,
  UpsertSearchProviderInput,
} from "@/lib/schemas/search-provider";

export const searchProviderKeys = {
  all: ["search-providers"] as const,
  list: () => [...searchProviderKeys.all, "list"] as const,
};

export function useSearchProviders() {
  return useQuery({
    queryKey: searchProviderKeys.list(),
    queryFn: listSearchProviders,
  });
}

function useInvalidateSearchProviders() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: searchProviderKeys.all });
  };
}

export function useUpsertSearchProvider() {
  const invalidate = useInvalidateSearchProviders();
  return useMutation({
    mutationFn: ({
      provider,
      input,
    }: {
      provider: SearchProvider;
      input: UpsertSearchProviderInput;
    }) => upsertSearchProvider(provider, input),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteSearchProvider() {
  const invalidate = useInvalidateSearchProviders();
  return useMutation({
    mutationFn: (provider: SearchProvider) => deleteSearchProvider(provider),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useReorderSearchProviders() {
  const invalidate = useInvalidateSearchProviders();
  return useMutation({
    mutationFn: (input: ReorderSearchProvidersInput) =>
      reorderSearchProviders(input),
    onSuccess: () => {
      invalidate();
    },
  });
}
