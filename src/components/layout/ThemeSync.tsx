"use client";

import { useThemeSync } from "@/components/layout/use-theme-sync";
import type { ThemeMode } from "@/lib/theme";

type ThemeSyncProps = {
  initialMode: ThemeMode;
};

export default function ThemeSync({ initialMode }: ThemeSyncProps) {
  useThemeSync(initialMode);
  return null;
}
