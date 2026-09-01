"use client";

import { useEffect } from "react";

import {
  themeDocumentCookie,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

export function persistTheme(mode: ThemeMode) {
  const resolved: ResolvedTheme =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.cookie = themeDocumentCookie({ mode, resolved });
}

export function useThemeSync(mode: ThemeMode) {
  useEffect(() => {
    persistTheme(mode);
    if (mode !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => persistTheme("system");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [mode]);
}
