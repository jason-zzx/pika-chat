import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SettingsBadgeTone = "neutral" | "success" | "destructive";

const DOT_STYLES: Record<SettingsBadgeTone, string> = {
  neutral: "bg-muted-foreground/40",
  success: "bg-success",
  destructive: "bg-destructive",
};

type SettingsBadgeProps = {
  tone?: SettingsBadgeTone;
  /** Set false for category tags (roles, visibility) that carry no status. */
  dot?: boolean;
  children: ReactNode;
};

/** Quiet status pill — the dot carries the tone, the text stays neutral. */
export default function SettingsBadge({
  tone = "neutral",
  dot = true,
  children,
}: SettingsBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground",
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", DOT_STYLES[tone])}
        />
      ) : null}
      {children}
    </span>
  );
}
