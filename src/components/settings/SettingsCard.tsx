import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
};

/**
 * The shared surface for every settings panel: rounded corners, a hairline
 * border, and a whisper of shadow. Padding is left to the consumer — row
 * layouts divide internally, forms pad the whole card.
 */
export default function SettingsCard({ children, className }: SettingsCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}
