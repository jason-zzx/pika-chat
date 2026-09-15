import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_COOKIE,
  nextThemeMode,
  parseThemeCookie,
  parseThemePreset,
  serializeThemeCookie,
} from "./theme";

describe("parseThemeCookie", () => {
  it("falls back when the cookie is absent", () => {
    expect(parseThemeCookie(undefined)).toEqual(DEFAULT_THEME_COOKIE);
    expect(parseThemeCookie("")).toEqual(DEFAULT_THEME_COOKIE);
  });

  it("falls back when the cookie is malformed", () => {
    expect(parseThemeCookie("nope")).toEqual(DEFAULT_THEME_COOKIE);
    expect(parseThemeCookie("light")).toEqual(DEFAULT_THEME_COOKIE);
    expect(parseThemeCookie("light:blue")).toEqual(DEFAULT_THEME_COOKIE);
    expect(parseThemeCookie("dim:dark")).toEqual(DEFAULT_THEME_COOKIE);
    expect(parseThemeCookie("system:")).toEqual(DEFAULT_THEME_COOKIE);
    expect(parseThemeCookie("light:dark:paper:extra")).toEqual(
      DEFAULT_THEME_COOKIE,
    );
  });

  it("parses each valid three-segment value", () => {
    expect(parseThemeCookie("light:light:default")).toEqual({
      mode: "light",
      resolved: "light",
      preset: "default",
    });
    expect(parseThemeCookie("dark:dark:ocean")).toEqual({
      mode: "dark",
      resolved: "dark",
      preset: "ocean",
    });
    expect(parseThemeCookie("system:light:violet")).toEqual({
      mode: "system",
      resolved: "light",
      preset: "violet",
    });
    expect(parseThemeCookie("system:dark:paper")).toEqual({
      mode: "system",
      resolved: "dark",
      preset: "paper",
    });
  });

  it("parses the legacy two-segment format with the default preset", () => {
    expect(parseThemeCookie("dark:dark")).toEqual({
      mode: "dark",
      resolved: "dark",
      preset: "default",
    });
    expect(parseThemeCookie("system:light")).toEqual({
      mode: "system",
      resolved: "light",
      preset: "default",
    });
  });

  it("falls back to the default preset for an unknown preset segment", () => {
    expect(parseThemeCookie("dark:dark:neon")).toEqual({
      mode: "dark",
      resolved: "dark",
      preset: "default",
    });
  });
});

describe("parseThemePreset", () => {
  it("accepts every preset name", () => {
    expect(parseThemePreset("default")).toBe("default");
    expect(parseThemePreset("paper")).toBe("paper");
    expect(parseThemePreset("graphite")).toBe("graphite");
    expect(parseThemePreset("ocean")).toBe("ocean");
    expect(parseThemePreset("forest")).toBe("forest");
    expect(parseThemePreset("rose")).toBe("rose");
    expect(parseThemePreset("violet")).toBe("violet");
  });

  it("falls back to default for anything else", () => {
    expect(parseThemePreset("neon")).toBe("default");
    expect(parseThemePreset("")).toBe("default");
    expect(parseThemePreset(undefined)).toBe("default");
    expect(parseThemePreset(null)).toBe("default");
    expect(parseThemePreset(42)).toBe("default");
  });
});

describe("serializeThemeCookie", () => {
  it("round-trips through parseThemeCookie", () => {
    const value = {
      mode: "system" as const,
      resolved: "dark" as const,
      preset: "forest" as const,
    };
    expect(parseThemeCookie(serializeThemeCookie(value))).toEqual(value);
  });

  it("writes the three-segment format", () => {
    expect(
      serializeThemeCookie({ mode: "dark", resolved: "dark", preset: "rose" }),
    ).toBe("dark:dark:rose");
  });
});

describe("nextThemeMode", () => {
  it("cycles light → dark → system → light", () => {
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
    expect(nextThemeMode("system")).toBe("light");
  });
});
