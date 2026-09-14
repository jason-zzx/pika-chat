"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { deleteChatFile, getFileLimits, listChatFiles } from "@/lib/api/files";
import { FILE_LIST_DEFAULT_LIMIT } from "@/lib/files/constants";
import type { FileListCategory } from "@/lib/files/media-types";

export const fileKeys = {
  all: ["files"] as const,
  list: (category: FileListCategory | null) =>
    [...fileKeys.all, "list", category ?? "all"] as const,
  limits: () => [...fileKeys.all, "limits"] as const,
};

/**
 * Offset-paginated attachment list. The category is part of the query key, so
 * switching a filter starts a fresh cache entry at offset 0 — pagination resets
 * without any manual state juggling.
 */
export function useFileList(category: FileListCategory | null) {
  return useInfiniteQuery({
    queryKey: fileKeys.list(category),
    queryFn: ({ pageParam }) =>
      listChatFiles({
        offset: pageParam,
        limit: FILE_LIST_DEFAULT_LIMIT,
        category,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce(
        (sum, page) => sum + page.files.length,
        0,
      );
      return loaded < lastPage.totalCount ? loaded : undefined;
    },
  });
}

/** Usage and quota for the usage card. Surfaces failure instead of defaulting. */
export function useFileLimits() {
  return useQuery({
    queryKey: fileKeys.limits(),
    queryFn: getFileLimits,
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => deleteChatFile(fileId),
    // Settled, not success: a 409 means a message started referencing the file
    // after this page loaded, so the list must refetch to show it as in-use.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: fileKeys.all });
    },
  });
}
