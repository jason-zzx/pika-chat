"use client";

import { CircleUserRoundIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
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
import { toast } from "@/components/ui/toast";
import { useIsGuest } from "@/hooks/use-is-guest";
import type { ActorRole } from "@/lib/auth-hierarchy";
import { signOutAndReset } from "@/lib/sign-out";

type SidebarUserMenuProps = {
  name: string;
  role: ActorRole;
};

export default function SidebarUserMenu({ name, role }: SidebarUserMenuProps) {
  const { setOpenMobile } = useSidebar();
  const isGuest = useIsGuest();
  const t = useTranslations("Layout");
  const tAuth = useTranslations("Auth");

  async function onSignOut() {
    setOpenMobile(false);
    // Last action of this document: the old account's query cache, chat pool
    // and in-flight subscriptions are discarded by the full page load. A
    // failed sign-out leaves the document (and the session) intact and says so.
    try {
      await signOutAndReset();
    } catch {
      toast.add({ type: "error", title: tAuth("signOutFailed") });
    }
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
              {isGuest
                ? `${name} · ${t("userMenu.guestBadge")}`
                : `${name} · ${role === "super_admin" ? t("userMenu.superAdmin") : role}`}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          {!isGuest ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void onSignOut()}>
                {t("userMenu.signOut")}
              </DropdownMenuItem>
            </>
          ) : null}
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
