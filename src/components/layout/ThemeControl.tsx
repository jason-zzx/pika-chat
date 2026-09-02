"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { persistTheme } from "@/components/layout/use-theme-sync";
import { Button } from "@/components/ui/button";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { nextThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEME_COPY: Record<
  ThemeMode,
  { label: string; icon: typeof SunIcon }
> = {
  light: { label: "Light", icon: SunIcon },
  dark: { label: "Dark", icon: MoonIcon },
  system: { label: "System", icon: MonitorIcon },
};

type ThemeControlProps = {
  initialMode: ThemeMode;
  className?: string;
  appearance?: "page" | "sidebar";
};

export default function ThemeControl({
  initialMode,
  className,
  appearance = "page",
}: ThemeControlProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const [prevInitialMode, setPrevInitialMode] = useState(initialMode);
  if (prevInitialMode !== initialMode) {
    setPrevInitialMode(initialMode);
    setMode(initialMode);
  }
  const current = THEME_COPY[mode];
  const next = THEME_COPY[nextThemeMode(mode)];
  const Icon = current.icon;

  function onCycle() {
    const following = nextThemeMode(mode);
    setMode(following);
    persistTheme(following);
    router.refresh();
  }

  if (appearance === "sidebar") {
    return (
      <SidebarMenuButton
        type="button"
        className={className}
        tooltip={`Switch to ${next.label}`}
        aria-label={`Theme: ${current.label}`}
        onClick={onCycle}
      >
        <Icon aria-hidden="true" />
        <span>{current.label}</span>
      </SidebarMenuButton>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("justify-start gap-2", className)}
      aria-label={`Theme: ${current.label}`}
      onClick={onCycle}
    >
      <Icon aria-hidden="true" />
      <span>{current.label}</span>
    </Button>
  );
}
