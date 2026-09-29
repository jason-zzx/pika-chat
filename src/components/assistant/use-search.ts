"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { searchTopicsAndMessages } from "@/lib/api/search";

export const searchKeys = {
  all: ["search"] as const,
  query: (q: string) => [...searchKeys.all, "query", q] as const,
};

/** Debounces a changing value; the leading edge of each burst lags by
 * `delayMs`, which is exactly what a type-as-you-search box wants. */
export function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Global topic/message search. Disabled for an empty query — the caller
 * renders the tree in that state and never reads the result. */
export function useSearch(query: string) {
  return useQuery({
    queryKey: searchKeys.query(query),
    queryFn: () => searchTopicsAndMessages(query),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  });
}
