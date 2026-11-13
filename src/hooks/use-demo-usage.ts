"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchDemoUsage } from "@/lib/api/demo";

export const demoUsageKeys = {
  all: ["demo", "usage"] as const,
};

export function useDemoUsage(enabled: boolean) {
  return useQuery({
    queryKey: demoUsageKeys.all,
    queryFn: fetchDemoUsage,
    enabled,
    staleTime: 30_000,
  });
}
