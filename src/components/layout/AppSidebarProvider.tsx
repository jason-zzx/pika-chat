"use client";

import type { ComponentProps } from "react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { usePikaNative } from "@/hooks/use-pika-native";

export default function AppSidebarProvider(
  props: ComponentProps<typeof SidebarProvider>,
) {
  const isDesktop = Boolean(usePikaNative()?.desktop);

  return (
    <SidebarProvider
      {...props}
      data-chrome={isDesktop ? "desktop" : undefined}
    />
  );
}
