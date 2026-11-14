import type { ReactNode } from "react";

import SearchDialog from "@/components/assistant/SearchDialog";
import AppSidebar from "@/components/layout/AppSidebar";
import DemoBanner from "@/components/layout/DemoBanner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { IsGuestProvider } from "@/hooks/use-is-guest";
import type { ActorRole } from "@/lib/auth-hierarchy";
import type { ThemePreference } from "@/lib/theme";

type AppShellProps = {
  children: ReactNode;
  defaultSidebarOpen: boolean;
  user: {
    name: string;
    role: ActorRole;
    isGuest: boolean;
  };
  themePreference: ThemePreference;
};

export default function AppShell({
  children,
  defaultSidebarOpen,
  user,
  themePreference,
}: AppShellProps) {
  return (
    <IsGuestProvider value={user.isGuest}>
      <SidebarProvider
        defaultOpen={defaultSidebarOpen}
        className="h-svh overflow-hidden"
      >
        <AppSidebar
          name={user.name}
          role={user.role}
          themePreference={themePreference}
        />
        <SidebarInset className="min-h-0 overflow-hidden">
          {user.isGuest ? <DemoBanner /> : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </SidebarInset>
        {/* Globally mounted so Ctrl/Cmd+K works on every page, including
            routes where the sidebar tree is not rendered. */}
        <SearchDialog />
      </SidebarProvider>
    </IsGuestProvider>
  );
}
