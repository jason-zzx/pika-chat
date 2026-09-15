import type { ReactNode } from "react";

import AppSidebar from "@/components/layout/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { ActorRole } from "@/lib/auth-hierarchy";
import type { ThemePreference } from "@/lib/theme";

type AppShellProps = {
  children: ReactNode;
  defaultSidebarOpen: boolean;
  user: {
    name: string;
    role: ActorRole;
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
