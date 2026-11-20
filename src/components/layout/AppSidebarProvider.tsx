"use client";

import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { SidebarProvider } from "@/components/ui/sidebar";

export default function AppSidebarProvider(
  props: Omit<ComponentProps<typeof SidebarProvider>, "lockedOpen">,
) {
  const pathname = usePathname();
  const lockedOpen =
    pathname === "/settings" || pathname.startsWith("/settings/");

  return <SidebarProvider {...props} lockedOpen={lockedOpen} />;
}
