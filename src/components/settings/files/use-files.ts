"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { fileKeys } from "@/hooks/use-file-limits";
import { listChatFiles } from "@/lib/api/files";
import { FILE_LIST_DEFAULT_LIMIT } from "@/lib/files/constants";
import type { FileListCategory } from "@/lib/files/media-types";

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
