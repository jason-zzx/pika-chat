"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { persistTheme } from "@/components/layout/use-theme-sync";
import { Button } from "@/components/ui/button";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { nextThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEME_ICONS: Record<ThemeMode, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
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
  const t = useTranslations("Layout");
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const [prevInitialMode, setPrevInitialMode] = useState(initialMode);
  if (prevInitialMode !== initialMode) {
    setPrevInitialMode(initialMode);
    setMode(initialMode);
  }
  const currentLabel = t(`theme.${mode}`);
  const nextLabel = t(`theme.${nextThemeMode(mode)}`);
  const Icon = THEME_ICONS[mode];

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
        tooltip={t("theme.switchTo", { theme: nextLabel })}
        aria-label={t("theme.current", { theme: currentLabel })}
        onClick={onCycle}
      >
        <Icon aria-hidden="true" />
        <span>{currentLabel}</span>
      </SidebarMenuButton>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("justify-start gap-2", className)}
      aria-label={t("theme.current", { theme: currentLabel })}
      onClick={onCycle}
    >
      <Icon aria-hidden="true" />
      <span>{currentLabel}</span>
    </Button>
  );
}
