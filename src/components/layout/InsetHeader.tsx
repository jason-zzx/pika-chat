"use client";

import type { ReactNode } from "react";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type InsetHeaderProps = {
  title?: string | null;
  subtitle?: string | null;
  actions?: ReactNode;
  className?: string;
};

export default function InsetHeader({
  title,
  subtitle,
  actions,
  className,
}: InsetHeaderProps) {
  return (
    <header
      className={cn(
        "flex min-h-13 shrink-0 items-center gap-2 border-b border-border px-3 py-1 md:min-h-12 md:px-5",
        className,
      )}
    >
      <SidebarTrigger className="size-9 md:hidden [&_svg]:size-5" />
      {title ? (
        <div className="flex min-w-0 flex-col justify-center">
          <h1 className="min-w-0 truncate text-[17px] font-semibold tracking-tight md:text-base">
            {title}
          </h1>
          {subtitle ? (
            <p className="min-w-0 truncate text-[13px] text-muted-foreground md:text-xs">
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}
      {actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
