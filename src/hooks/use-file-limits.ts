"use client";

import { useQuery } from "@tanstack/react-query";

import { getFileLimits } from "@/lib/api/files";
import type { FileListCategory } from "@/lib/files/media-types";

/**
 * Attachment query keys, shared by the chat composer and the settings files
 * screen so both hit one cache.
 */
export const fileKeys = {
  all: ["files"] as const,
  list: (category: FileListCategory | null) =>
    [...fileKeys.all, "list", category ?? "all"] as const,
  limits: () => [...fileKeys.all, "limits"] as const,
};

/** Usage and quota for the usage card. Surfaces failure instead of defaulting. */
export function useFileLimits() {
  return useQuery({
    queryKey: fileKeys.limits(),
    queryFn: getFileLimits,
  });
}
