import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export default function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6 pb-12",
        className,
      )}
    >
      {children}
    </div>
  );
}
