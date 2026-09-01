"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";

type SidebarNavLinkProps = {
  href: string;
  children: ReactNode;
  tooltip?: string;
};

export default function SidebarNavLink({
  href,
  children,
  tooltip,
}: SidebarNavLinkProps) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenuButton
      render={<Link href={href} />}
      tooltip={tooltip}
      onClick={() => setOpenMobile(false)}
    >
      {children}
    </SidebarMenuButton>
  );
}
