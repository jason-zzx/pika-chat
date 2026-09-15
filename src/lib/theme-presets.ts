import type { ThemePreset } from "./theme";

export type ThemePresetSwatch = {
  background: string;
  foreground: string;
  primary: string;
  accent: string;
  border: string;
};

export type ThemePresetPreview = {
  light: ThemePresetSwatch;
  dark: ThemePresetSwatch;
};

/**
 * Thumbnail swatches for ThemePresetControl. Values mirror the matching
 * tokens in the [data-theme="…"] blocks of src/app/globals.css (and :root /
 * .dark for "default") — keep in sync by hand; scripts/check-theme-tokens.mjs
 * guarantees CSS token completeness but does not check these previews.
 */
export const THEME_PRESET_PREVIEWS: Record<ThemePreset, ThemePresetPreview> = {
  default: {
    light: {
      background: "oklch(0.985 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: "oklch(0.205 0 0)",
      accent: "oklch(0.97 0 0)",
      border: "oklch(0.92 0.006 75)",
    },
    dark: {
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
      primary: "oklch(0.922 0 0)",
      accent: "oklch(0.26 0 0)",
      border: "oklch(1 0 0 / 10%)",
    },
  },
  paper: {
    light: {
      background: "oklch(0.975 0.012 85)",
      foreground: "oklch(0.28 0.02 60)",
      primary: "oklch(0.52 0.1 50)",
      accent: "oklch(0.94 0.015 85)",
      border: "oklch(0.895 0.015 80)",
    },
    dark: {
      background: "oklch(0.19 0.012 70)",
      foreground: "oklch(0.93 0.01 85)",
      primary: "oklch(0.74 0.11 60)",
      accent: "oklch(0.28 0.013 70)",
      border: "oklch(0.32 0.013 70)",
    },
  },
  graphite: {
    light: {
      background: "oklch(0.982 0.004 250)",
      foreground: "oklch(0.21 0.01 260)",
      primary: "oklch(0.27 0.02 260)",
      accent: "oklch(0.955 0.006 250)",
      border: "oklch(0.91 0.006 250)",
    },
    dark: {
      background: "oklch(0.165 0.008 260)",
      foreground: "oklch(0.955 0.005 250)",
      primary: "oklch(0.65 0.13 255)",
      accent: "oklch(0.25 0.01 260)",
      border: "oklch(0.29 0.012 260)",
    },
  },
  ocean: {
    light: {
      background: "oklch(0.984 0.005 240)",
      foreground: "oklch(0.23 0.025 250)",
      primary: "oklch(0.55 0.16 255)",
      accent: "oklch(0.95 0.01 245)",
      border: "oklch(0.9 0.01 245)",
    },
    dark: {
      background: "oklch(0.175 0.03 258)",
      foreground: "oklch(0.945 0.01 240)",
      primary: "oklch(0.7 0.14 250)",
      accent: "oklch(0.26 0.03 256)",
      border: "oklch(0.3 0.03 256)",
    },
  },
  forest: {
    light: {
      background: "oklch(0.98 0.006 155)",
      foreground: "oklch(0.25 0.02 160)",
      primary: "oklch(0.46 0.08 162)",
      accent: "oklch(0.948 0.012 155)",
      border: "oklch(0.9 0.012 155)",
    },
    dark: {
      background: "oklch(0.185 0.014 160)",
      foreground: "oklch(0.935 0.012 150)",
      primary: "oklch(0.68 0.1 162)",
      accent: "oklch(0.265 0.015 158)",
      border: "oklch(0.305 0.015 158)",
    },
  },
  rose: {
    light: {
      background: "oklch(0.972 0.01 355)",
      foreground: "oklch(0.3 0.025 350)",
      primary: "oklch(0.56 0.13 350)",
      accent: "oklch(0.94 0.015 355)",
      border: "oklch(0.895 0.015 355)",
    },
    dark: {
      background: "oklch(0.19 0.014 355)",
      foreground: "oklch(0.935 0.01 350)",
      primary: "oklch(0.72 0.11 350)",
      accent: "oklch(0.27 0.015 352)",
      border: "oklch(0.31 0.015 352)",
    },
  },
  violet: {
    light: {
      background: "oklch(0.981 0.006 300)",
      foreground: "oklch(0.26 0.02 300)",
      primary: "oklch(0.48 0.1 295)",
      accent: "oklch(0.952 0.01 300)",
      border: "oklch(0.905 0.01 300)",
    },
    dark: {
      background: "oklch(0.185 0.014 300)",
      foreground: "oklch(0.94 0.008 300)",
      primary: "oklch(0.7 0.09 295)",
      accent: "oklch(0.265 0.015 300)",
      border: "oklch(0.305 0.015 300)",
    },
  },
};
