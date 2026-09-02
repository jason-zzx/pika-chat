export const THEME_COOKIE_NAME = "pika_theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type ThemeCookie = { mode: ThemeMode; resolved: ResolvedTheme };

export const DEFAULT_THEME_COOKIE: ThemeCookie = {
  mode: "system",
  resolved: "light",
};

export function parseThemeCookie(raw: string | undefined): ThemeCookie {
  if (raw == null || raw === "") {
    return DEFAULT_THEME_COOKIE;
  }
  const separator = raw.indexOf(":");
  if (separator === -1) {
    return DEFAULT_THEME_COOKIE;
  }
  const mode = raw.slice(0, separator);
  const resolved = raw.slice(separator + 1);
  if (mode !== "light" && mode !== "dark" && mode !== "system") {
    return DEFAULT_THEME_COOKIE;
  }
  if (resolved !== "light" && resolved !== "dark") {
    return DEFAULT_THEME_COOKIE;
  }
  return { mode, resolved };
}

export function serializeThemeCookie(value: ThemeCookie): string {
  return `${value.mode}:${value.resolved}`;
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
