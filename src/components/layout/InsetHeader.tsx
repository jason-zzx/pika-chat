"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

type InsetHeaderProps = {
  title?: string | null;
  subtitle?: string | null;
};

export default function InsetHeader({ title, subtitle }: InsetHeaderProps) {
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 py-1">
      <SidebarTrigger />
      {title ? (
        <div className="flex min-w-0 flex-col justify-center">
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
