"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { useUpdateThemePreference } from "@/hooks/use-update-theme-preference";
import { nextThemeMode, type ThemeMode, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEME_ICONS: Record<ThemeMode, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

type ThemeControlProps = {
  initialPreference: ThemePreference;
  className?: string;
  appearance?: "page" | "sidebar";
};

export default function ThemeControl({
  initialPreference,
  className,
  appearance = "page",
}: ThemeControlProps) {
  const t = useTranslations("Layout");
  const { preference, updatePreference } =
    useUpdateThemePreference(initialPreference);
  const mode = preference.mode;
  const currentLabel = t(`theme.${mode}`);
  const nextLabel = t(`theme.${nextThemeMode(mode)}`);
  const Icon = THEME_ICONS[mode];

  function onCycle() {
    updatePreference({ ...preference, mode: nextThemeMode(mode) });
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
