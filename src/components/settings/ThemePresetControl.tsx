"use client";

import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { useUpdateThemePreference } from "@/hooks/use-update-theme-preference";
import {
  THEME_PRESETS,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";
import { THEME_PRESET_PREVIEWS } from "@/lib/theme-presets";
import { cn } from "@/lib/utils";

function subscribeSystemTheme(callback: () => void) {
  if (typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getSystemThemeSnapshot(): ResolvedTheme {
  if (typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Resolved OS preference; SSR and the hydration render show "light". */
function useSystemTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    () => "light",
  );
}

type ThemePresetControlProps = {
  initialPreference: ThemePreference;
};

/**
 * Preset swatch picker for settings/general. Thumbnails inline the oklch
 * preview constants from lib/theme-presets.ts (a genuinely dynamic value —
 * the sanctioned inline-style exception) and follow the currently resolved
 * light/dark mode. Selection goes through useUpdateThemePreference: instant
 * local apply, background PATCH, revert + toast on failure.
 */
export default function ThemePresetControl({
  initialPreference,
}: ThemePresetControlProps) {
  const t = useTranslations("Settings.General");
  const { preference, updatePreference } =
    useUpdateThemePreference(initialPreference);
  const systemTheme = useSystemTheme();
  const resolved = preference.mode === "system" ? systemTheme : preference.mode;

  return (
    <div
      role="group"
      aria-label={t("preset")}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
    >
      {THEME_PRESETS.map((preset) => {
        const preview = THEME_PRESET_PREVIEWS[preset][resolved];
        const selected = preset === preference.preset;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={selected}
            onClick={() => updatePreference({ ...preference, preset })}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
              selected
                ? "border-primary ring-2 ring-ring/40"
                : "border-border hover:bg-accent/60",
            )}
          >
            <span
              aria-hidden="true"
              className="flex h-16 w-full flex-col justify-between rounded-md p-2"
              style={{
                background: preview.background,
                boxShadow: `inset 0 0 0 1px ${preview.border}`,
              }}
            >
              <span
                className="h-2 w-2/3 rounded-full"
                style={{ background: preview.foreground }}
              />
              <span className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-full"
                  style={{ background: preview.primary }}
                />
                <span
                  className="size-3 rounded-full"
                  style={{
                    background: preview.accent,
                    boxShadow: `inset 0 0 0 1px ${preview.border}`,
                  }}
                />
              </span>
            </span>
            <span className="flex items-center justify-between gap-1 text-xs font-medium">
              {t(`presets.${preset}`)}
              {selected ? (
                <CheckIcon aria-hidden="true" className="size-3.5 text-primary" />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
