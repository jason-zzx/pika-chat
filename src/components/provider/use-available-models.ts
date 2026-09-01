"use client";

import { useQuery } from "@tanstack/react-query";

import { listAvailableModels } from "@/lib/api/provider";

export const availableModelKeys = {
  all: ["available-models"] as const,
};

export function useAvailableModels() {
  return useQuery({
    queryKey: availableModelKeys.all,
    queryFn: listAvailableModels,
  });
}
