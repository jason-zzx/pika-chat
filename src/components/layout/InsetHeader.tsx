"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

type InsetHeaderProps = {
  title?: string | null;
};

export default function InsetHeader({ title }: InsetHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <SidebarTrigger />
      {title ? (
        <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">
          {title}
        </h1>
      ) : null}
    </header>
  );
}
