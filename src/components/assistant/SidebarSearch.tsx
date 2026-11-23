"use client";

import { SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { SidebarInput, SidebarMenuButton } from "@/components/ui/sidebar";
import { useSearchDialogStore } from "@/stores/search-dialog-store";

/** Persistent search row between the sidebar header and the tree. The box is
 * an entry point only: focusing or clicking it (or the icon-rail button)
 * opens the global search dialog; the topic tree is never replaced. */
export default function SidebarSearch() {
  const t = useTranslations("Search.palette");
  const tSidebar = useTranslations("Search.sidebar");
  const setOpen = useSearchDialogStore((state) => state.setOpen);

  return (
    <div className="shrink-0 px-2 pb-1.5 md:pb-1">
      <SidebarMenuButton
        type="button"
        tooltip={t("openSearch")}
        aria-label={t("openSearch")}
        className="hidden group-data-[collapsible=icon]:flex"
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden="true" />
      </SidebarMenuButton>
      <div className="relative group-data-[collapsible=icon]:hidden">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-muted-foreground md:left-2.5 md:size-4"
        />
        {/* readOnly entry box: focusing (keyboard) and clicking (already
            focused) both open the dialog. mousedown is prevented so a
            mouse press never focuses the box: the open then happens on
            click, AFTER the click has fully dispatched. Opening on
            mousedown-focus instead lets the trailing click land on the
            dialog's just-attached outside-press listener, which dismisses
            it again (the open-flash bug). */}
        <SidebarInput
          readOnly
          value=""
          placeholder={tSidebar("placeholder")}
          aria-label={tSidebar("placeholder")}
          className="pl-9 md:pl-8"
          onMouseDown={(event) => event.preventDefault()}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
        />
      </div>
    </div>
  );
}
