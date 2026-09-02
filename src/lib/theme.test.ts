import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_COOKIE,
  nextThemeMode,
  parseThemeCookie,
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
  });

  it("parses each valid value", () => {
    expect(parseThemeCookie("light:light")).toEqual({
      mode: "light",
      resolved: "light",
    });
    expect(parseThemeCookie("dark:dark")).toEqual({
      mode: "dark",
      resolved: "dark",
    });
    expect(parseThemeCookie("system:light")).toEqual({
      mode: "system",
      resolved: "light",
    });
    expect(parseThemeCookie("system:dark")).toEqual({
      mode: "system",
      resolved: "dark",
    });
  });
});

describe("serializeThemeCookie", () => {
  it("round-trips through parseThemeCookie", () => {
    const value = { mode: "system" as const, resolved: "dark" as const };
    expect(parseThemeCookie(serializeThemeCookie(value))).toEqual(value);
  });
});

describe("nextThemeMode", () => {
  it("cycles light → dark → system → light", () => {
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
    expect(nextThemeMode("system")).toBe("light");
  });
});
