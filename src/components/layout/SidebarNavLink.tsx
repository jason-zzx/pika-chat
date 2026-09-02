"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";

type SidebarNavLinkProps = {
  href: string;
  children: ReactNode;
  tooltip?: string;
  isActive?: boolean;
};

export default function SidebarNavLink({
  href,
  children,
  tooltip,
  isActive = false,
}: SidebarNavLinkProps) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenuButton
      render={
        <Link
          href={href}
          aria-current={isActive ? "page" : undefined}
        />
      }
      tooltip={tooltip}
      isActive={isActive}
      onClick={() => setOpenMobile(false)}
    >
      {children}
    </SidebarMenuButton>
  );
}
