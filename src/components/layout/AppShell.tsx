import type { ReactNode } from "react";

import AppSidebar from "@/components/layout/AppSidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { ActorRole } from "@/lib/auth-hierarchy";
import type { ThemeMode } from "@/lib/theme";

type AppShellProps = {
  children: ReactNode;
  defaultSidebarOpen: boolean;
  user: {
    name: string;
    role: ActorRole;
  };
  themeMode: ThemeMode;
};

export default function AppShell({
  children,
  defaultSidebarOpen,
  user,
  themeMode,
}: AppShellProps) {
  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <AppSidebar name={user.name} role={user.role} themeMode={themeMode} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <SidebarTrigger />
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
