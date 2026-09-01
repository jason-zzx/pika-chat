import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ThemeSync from "./ThemeSync";
import { THEME_COOKIE_NAME } from "@/lib/theme";

function cookieValue(): string | undefined {
  const prefix = `${THEME_COOKIE_NAME}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function createMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  return {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener(_type: string, listener: EventListener) {
      listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeEventListener(_type: string, listener: EventListener) {
      listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return true;
    },
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

describe("ThemeSync", () => {
  beforeEach(() => {
    document.cookie = `${THEME_COOKIE_NAME}=; max-age=0; path=/`;
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    document.cookie = `${THEME_COOKIE_NAME}=; max-age=0; path=/`;
    document.documentElement.classList.remove("dark");
  });

  it("follows a matchMedia change while mode is system", () => {
    const media = createMatchMedia(false);
    window.matchMedia = () => media as unknown as MediaQueryList;

    render(<ThemeSync initialMode="system" />);

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(cookieValue()).toBe("system:light");

    media.setMatches(true);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(cookieValue()).toBe("system:dark");
  });
});
