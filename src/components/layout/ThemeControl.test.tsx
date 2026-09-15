import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_COOKIE_NAME, type ThemePreference } from "@/lib/theme";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import ThemeControl from "./ThemeControl";

const { refresh, toastAdd } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { add: toastAdd },
}));

function cookieValue(): string | undefined {
  const prefix = `${THEME_COOKIE_NAME}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function renderControl(
  initialPreference: ThemePreference,
  appearance?: "page" | "sidebar",
) {
  return renderWithIntl(
    <TooltipProvider>
      <SidebarProvider>
        <ThemeControl
          initialPreference={initialPreference}
          appearance={appearance}
        />
      </SidebarProvider>
    </TooltipProvider>,
  );
}

describe("ThemeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ themeMode: "dark", themePreset: "default" }), {
          status: 200,
        }),
      ),
    );
    document.cookie = `${THEME_COOKIE_NAME}=; max-age=0; path=/`;
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    window.matchMedia = () =>
      ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = `${THEME_COOKIE_NAME}=; max-age=0; path=/`;
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
  });

  it("cycles light → dark → system and updates the cookie and class", async () => {
    renderControl({ mode: "light", preset: "default" });

    const button = screen.getByRole("button", { name: "Theme: Light" });
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(cookieValue()).toBe("dark:dark:default");
    expect(
      screen.getByRole("button", { name: "Theme: Dark" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Theme: Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(cookieValue()).toBe("system:light:default");
    expect(
      screen.getByRole("button", { name: "Theme: System" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Theme: System" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(cookieValue()).toBe("light:light:default");
    expect(
      screen.getByRole("button", { name: "Theme: Light" }),
    ).toBeInTheDocument();
  });

  it("keeps the current preset while cycling the mode", () => {
    renderControl({ mode: "light", preset: "ocean" });

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));

    expect(document.documentElement.dataset.theme).toBe("ocean");
    expect(cookieValue()).toBe("dark:dark:ocean");
  });

  it("reverts locally and toasts when the PATCH fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "INTERNAL", messageKey: "unexpected" },
          }),
          { status: 500 },
        ),
      ),
    );
    renderControl({ mode: "light", preset: "default" });

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await waitFor(() => expect(toastAdd).toHaveBeenCalled());
    expect(toastAdd.mock.calls[0]?.[0]).toMatchObject({ type: "error" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(cookieValue()).toBe("light:light:default");
    expect(
      screen.getByRole("button", { name: "Theme: Light" }),
    ).toBeInTheDocument();
  });

  it("uses a sidebar menu button that still cycles the theme", () => {
    renderControl({ mode: "light", preset: "default" }, "sidebar");

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Theme: Dark" }),
    ).toBeInTheDocument();
  });
});
