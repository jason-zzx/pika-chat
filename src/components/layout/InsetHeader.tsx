"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

type InsetHeaderProps = {
  title?: string | null;
  subtitle?: string | null;
};

export default function InsetHeader({ title, subtitle }: InsetHeaderProps) {
  return (
    <header className="flex min-h-13 shrink-0 items-center gap-2 border-b border-border px-3 py-1 md:min-h-12">
      <SidebarTrigger className="size-9 md:size-7 [&_svg]:size-5 md:[&_svg]:size-4" />
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
    </header>
  );
}
