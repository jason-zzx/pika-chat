"use client";

import { CircleUserRoundIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("Layout");

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
          aria-label={t("userMenu.accountMenu", { name })}
        >
          <CircleUserRoundIcon aria-hidden="true" />
          <span className="truncate">{name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {name} · {role === "super_admin" ? t("userMenu.superAdmin") : role}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void onSignOut()}>
            {t("userMenu.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarMenuButton
        render={<Link href="/settings" />}
        tooltip={t("userMenu.settings")}
        aria-label={t("userMenu.settings")}
        className="size-8 shrink-0"
        onClick={() => setOpenMobile(false)}
      >
        <SettingsIcon aria-hidden="true" />
        <span className="sr-only">{t("userMenu.settings")}</span>
      </SidebarMenuButton>
    </div>
  );
}
