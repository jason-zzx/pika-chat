"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { SidebarInput, useSidebar } from "@/components/ui/sidebar";

type SidebarSearchProps = {
  query: string;
  onQueryChange: (query: string) => void;
};

/** Persistent search row between the sidebar header and the tree. In the
 * icon-collapsed rail it degenerates to a search button that re-expands the
 * sidebar and focuses the input. */
export default function SidebarSearch({
  query,
  onQueryChange,
}: SidebarSearchProps) {
  const t = useTranslations("Search.sidebar");
  const { state, toggleSidebar } = useSidebar();
  const inputRef = useRef<HTMLInputElement>(null);
  // Set by the collapsed-rail button; the input only exists (visibly) once
  // the rail has expanded again, so the focus waits for that state.
  const focusOnExpandRef = useRef(false);

  useEffect(() => {
    if (state === "expanded" && focusOnExpandRef.current) {
      focusOnExpandRef.current = false;
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <div className="shrink-0 px-2 pb-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("openSearch")}
        className="hidden w-full group-data-[collapsible=icon]:flex"
        onClick={() => {
          focusOnExpandRef.current = true;
          toggleSidebar();
        }}
      >
        <SearchIcon aria-hidden="true" />
      </Button>
      <div className="relative group-data-[collapsible=icon]:hidden">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <SidebarInput
          ref={inputRef}
          value={query}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="pl-8 pr-8"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onQueryChange("");
            }
          }}
        />
        {query.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("clear")}
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
          >
            <XIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
