import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IsGuestProvider } from "@/hooks/use-is-guest";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import AppSidebar from "./AppSidebar";
import AppSidebarProvider from "./AppSidebarProvider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/components/assistant/AssistantTree", () => ({
  default: () => <div data-testid="assistant-tree-stub" />,
}));

const account = { name: "Alice", role: "user" } as const;

function renderAppSidebar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <IsGuestProvider value={false}>
        <TooltipProvider>
          <AppSidebarProvider defaultOpen>
            <AppSidebar
              {...account}
              themePreference={{ mode: "system", preset: "default" }}
            />
            <SidebarInset>content</SidebarInset>
          </AppSidebarProvider>
        </TooltipProvider>
      </IsGuestProvider>
    </QueryClientProvider>,
  );
}

describe("AppSidebar", () => {
  afterEach(() => {
    delete window.pikaNative;
  });

  it("renders inset sidebar without hover rail or desktop chrome marker in browsers", () => {
    const view = renderAppSidebar();
    const wrapper = view.container.querySelector('[data-slot="sidebar-wrapper"]');
    const sidebar = view.container.querySelector('[data-slot="sidebar"]');
    expect(wrapper).not.toHaveAttribute("data-chrome");
    expect(sidebar).toHaveAttribute("data-variant", "inset");
    expect(view.container.querySelector('[data-sidebar="rail"]')).toBeNull();
    expect(screen.getByTestId("assistant-tree-stub")).toBeInTheDocument();
  });

  it("marks desktop chrome on sidebar wrapper and emits chrome-sync events inside desktop shell", () => {
    window.pikaNative = {
      serverName: "Work",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
      desktop: {
        platform: "linux",
        getSettings: vi.fn(),
        setCloseAction: vi.fn(),
        setHotkey: vi.fn(),
        getStorageUsage: vi.fn(),
        clearStorage: vi.fn(),
        openLocalDataFolder: vi.fn(),
        checkForUpdates: vi.fn(),
        openDevTools: vi.fn(),
        openDesktopLog: vi.fn(),
        setDeveloperMode: vi.fn(),
      },
    };
    const listener = vi.fn();
    window.addEventListener("pika:chrome-sync", listener);
    try {
      const view = renderAppSidebar();
      const wrapper = view.container.querySelector('[data-slot="sidebar-wrapper"]');
      const sidebar = view.container.querySelector('[data-slot="sidebar"]');
      expect(wrapper).toHaveAttribute("data-chrome", "desktop");
      expect(sidebar).toHaveAttribute("data-variant", "inset");
      expect(listener).toHaveBeenCalledTimes(1);
      view.unmount();
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("pika:chrome-sync", listener);
    }
  });
});
