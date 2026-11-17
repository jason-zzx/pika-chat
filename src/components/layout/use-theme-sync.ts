"use client";

import { useEffect } from "react";

import {
  themeDocumentCookie,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

export function persistTheme(preference: ThemePreference) {
  const resolved: ResolvedTheme =
    preference.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference.mode;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  if (preference.preset === "default") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = preference.preset;
  }
  // The installed PWA's status bar reads theme-color; mode and preset only
  // exist as CSS, so mirror the page background the browser just resolved.
  document
    .querySelector('meta[name="theme-color"]')!
    .setAttribute("content", getComputedStyle(document.body).backgroundColor);
  document.cookie = themeDocumentCookie({
    mode: preference.mode,
    resolved,
    preset: preference.preset,
  });
}

export function useThemeSync(preference: ThemePreference) {
  const { mode, preset } = preference;
  useEffect(() => {
    persistTheme({ mode, preset });
    if (mode !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => persistTheme({ mode: "system", preset });
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [mode, preset]);
}
