"use client";

import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { usePikaNative } from "@/hooks/use-pika-native";

export default function AppSidebarProvider(
  props: Omit<ComponentProps<typeof SidebarProvider>, "lockedOpen">,
) {
  const pathname = usePathname();
  const isDesktop = Boolean(usePikaNative()?.desktop);
  const lockedOpen =
    pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <SidebarProvider
      {...props}
      data-chrome={isDesktop ? "desktop" : undefined}
      lockedOpen={lockedOpen}
    />
  );
}
