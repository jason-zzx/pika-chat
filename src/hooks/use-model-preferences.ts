"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getModelPreferences,
  updateModelPreferences,
} from "@/lib/api/account";
import type { ModelPreferences } from "@/lib/schemas/model-preferences";

export const modelPreferencesKeys = {
  all: ["model-preferences"] as const,
};

/** The signed-in user's default model preferences (server state, Query). */
export function useModelPreferences() {
  return useQuery({
    queryKey: modelPreferencesKeys.all,
    queryFn: getModelPreferences,
  });
}

/** Whole-set replacement (a `null` slot clears it). Optimistic: the cache
 * snaps to the submitted set and rolls back on failure, then settles on the
 * server response. */
export function useUpdateModelPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateModelPreferences,
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: modelPreferencesKeys.all });
      const previous = queryClient.getQueryData<ModelPreferences>(
        modelPreferencesKeys.all,
      );
      queryClient.setQueryData(modelPreferencesKeys.all, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      queryClient.setQueryData(modelPreferencesKeys.all, context?.previous);
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(modelPreferencesKeys.all, preferences);
    },
  });
}
