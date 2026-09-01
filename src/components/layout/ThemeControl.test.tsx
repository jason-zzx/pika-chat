import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ThemeControl from "./ThemeControl";
import { THEME_COOKIE_NAME } from "@/lib/theme";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function cookieValue(): string | undefined {
  const prefix = `${THEME_COOKIE_NAME}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

describe("ThemeControl", () => {
  beforeEach(() => {
    document.cookie = `${THEME_COOKIE_NAME}=; max-age=0; path=/`;
    document.documentElement.classList.remove("dark");
    window.matchMedia = () =>
      ({ matches: false }) as unknown as MediaQueryList;
  });

  afterEach(() => {
    document.cookie = `${THEME_COOKIE_NAME}=; max-age=0; path=/`;
    document.documentElement.classList.remove("dark");
  });

  it("writes the cookie and toggles the class for each mode", () => {
    render(<ThemeControl initialMode="light" />);

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(cookieValue()).toBe("dark:dark");

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(cookieValue()).toBe("light:light");

    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(cookieValue()).toBe("system:light");
  });
});
