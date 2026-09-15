export const THEME_COOKIE_NAME = "pika_theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

// Read by scripts/check-theme-tokens.mjs, which derives its expected preset
// blocks from this array — keep the simple one-string-per-line array shape.
export const THEME_PRESETS = [
  "default",
  "paper",
  "graphite",
  "ocean",
  "forest",
  "rose",
  "violet",
] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];
export const DEFAULT_THEME_PRESET: ThemePreset = "default";

export type ThemePreference = { mode: ThemeMode; preset: ThemePreset };
export type ThemeCookie = ThemePreference & { resolved: ResolvedTheme };

export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  mode: "system",
  preset: DEFAULT_THEME_PRESET,
};

export const DEFAULT_THEME_COOKIE: ThemeCookie = {
  ...DEFAULT_THEME_PREFERENCE,
  resolved: "light",
};

export function parseThemePreset(raw: unknown): ThemePreset {
  if (typeof raw !== "string") {
    return DEFAULT_THEME_PRESET;
  }
  return (THEME_PRESETS as readonly string[]).includes(raw)
    ? (raw as ThemePreset)
    : DEFAULT_THEME_PRESET;
}

/** Falls back to the default mode; used when reading persisted values. */
export function parseThemeMode(raw: unknown): ThemeMode {
  return raw === "light" || raw === "dark" || raw === "system"
    ? raw
    : DEFAULT_THEME_PREFERENCE.mode;
}

function parseThemeModeSegment(raw: string): ThemeMode | null {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : null;
}

function parseResolvedTheme(raw: string): ResolvedTheme | null {
  return raw === "light" || raw === "dark" ? raw : null;
}

/**
 * Cookie format is `mode:resolved:preset`. The legacy two-segment form
 * (`mode:resolved`, pre-preset) still parses with preset "default".
 */
export function parseThemeCookie(raw: string | undefined): ThemeCookie {
  if (raw == null || raw === "") {
    return DEFAULT_THEME_COOKIE;
  }
  const segments = raw.split(":");
  if (segments.length !== 2 && segments.length !== 3) {
    return DEFAULT_THEME_COOKIE;
  }
  const [modeSegment, resolvedSegment, presetSegment] = segments;
  const mode = parseThemeModeSegment(modeSegment ?? "");
  const resolved = parseResolvedTheme(resolvedSegment ?? "");
  if (mode === null || resolved === null) {
    return DEFAULT_THEME_COOKIE;
  }
  const preset = parseThemePreset(presetSegment ?? "default");
  return { mode, resolved, preset };
}

export function serializeThemeCookie(value: ThemeCookie): string {
  return `${value.mode}:${value.resolved}:${value.preset}`;
}

export function themeDocumentCookie(value: ThemeCookie): string {
  return `${THEME_COOKIE_NAME}=${serializeThemeCookie(value)}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  switch (mode) {
    case "light":
      return "dark";
    case "dark":
      return "system";
    case "system":
      return "light";
  }
}
