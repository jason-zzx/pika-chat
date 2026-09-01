"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import ThemeControl from "@/components/layout/ThemeControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import type { ActorRole } from "@/lib/auth-hierarchy";
import type { ThemeMode } from "@/lib/theme";

type SidebarUserMenuProps = {
  name: string;
  role: ActorRole;
  themeMode: ThemeMode;
};

export default function SidebarUserMenu({
  name,
  role,
  themeMode,
}: SidebarUserMenuProps) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();

  async function onSignOut() {
    await authClient.signOut();
    setOpenMobile(false);
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton size="lg" />}
        aria-label={`Account menu for ${name}`}
      >
        <span className="truncate">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {name} · {role === "super_admin" ? "super admin" : role}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href="/settings" />}
          onClick={() => setOpenMobile(false)}
        >
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-1.5 py-1">
          <p className="px-0.5 pb-1 text-xs text-muted-foreground">Theme</p>
          <ThemeControl initialMode={themeMode} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void onSignOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
