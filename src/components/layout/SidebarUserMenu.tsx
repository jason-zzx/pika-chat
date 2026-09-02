"use client";

import { CircleUserRoundIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

type SidebarUserMenuProps = {
  name: string;
  role: ActorRole;
};

export default function SidebarUserMenu({ name, role }: SidebarUserMenuProps) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();

  async function onSignOut() {
    await authClient.signOut();
    setOpenMobile(false);
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-1 group-data-[collapsible=icon]:flex-col">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton className="flex-1" tooltip={name} />
          }
          aria-label={`Account menu for ${name}`}
        >
          <CircleUserRoundIcon aria-hidden="true" />
          <span className="truncate">{name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {name} · {role === "super_admin" ? "super admin" : role}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void onSignOut()}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarMenuButton
        render={<Link href="/settings" />}
        tooltip="Settings"
        aria-label="Settings"
        className="size-8 shrink-0"
        onClick={() => setOpenMobile(false)}
      >
        <SettingsIcon aria-hidden="true" />
        <span className="sr-only">Settings</span>
      </SidebarMenuButton>
    </div>
  );
}
