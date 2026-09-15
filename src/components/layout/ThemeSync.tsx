"use client";

import { useThemeSync } from "@/components/layout/use-theme-sync";
import type { ThemePreference } from "@/lib/theme";

type ThemeSyncProps = {
  initialPreference: ThemePreference;
};

export default function ThemeSync({ initialPreference }: ThemeSyncProps) {
  useThemeSync(initialPreference);
  return null;
}
