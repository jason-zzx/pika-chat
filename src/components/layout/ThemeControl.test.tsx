import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_COOKIE_NAME } from "@/lib/theme";

import ThemeControl from "./ThemeControl";

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

function renderControl(
  initialMode: "light" | "dark" | "system",
  appearance?: "page" | "sidebar",
) {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <ThemeControl initialMode={initialMode} appearance={appearance} />
      </SidebarProvider>
    </TooltipProvider>,
  );
}

describe("ThemeControl", () => {
  beforeEach(() => {
    document.cookie = `${THEME_COOKIE_NAME}=; max-age=0; path=/`;
    document.documentElement.classList.remove("dark");
    window.matchMedia = () =>
      ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList;
  });

  afterEach(() => {
    document.cookie = `${THEME_COOKIE_NAME}=; max-age=0; path=/`;
    document.documentElement.classList.remove("dark");
  });

  it("cycles light → dark → system and updates the cookie and class", () => {
    renderControl("light");

    const button = screen.getByRole("button", { name: "Theme: Light" });
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(cookieValue()).toBe("dark:dark");
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Theme: Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(cookieValue()).toBe("system:light");
    expect(
      screen.getByRole("button", { name: "Theme: System" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Theme: System" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(cookieValue()).toBe("light:light");
    expect(
      screen.getByRole("button", { name: "Theme: Light" }),
    ).toBeInTheDocument();
  });

  it("uses a sidebar menu button that still cycles the theme", () => {
    renderControl("light", "sidebar");

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Theme: Dark" }),
    ).toBeInTheDocument();
  });
});
