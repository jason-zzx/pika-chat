"use client";

import { ChevronsUpDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { usePikaNative } from "@/hooks/use-pika-native";

export default function DesktopServerChip() {
  const native = usePikaNative();
  const t = useTranslations("Layout.desktopServer");

  if (!native) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      aria-label={t("switchAria", { name: native.serverName })}
      className="ml-auto min-w-0 max-w-48 font-normal text-muted-foreground"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        native.showServerMenu({ x: rect.left, y: rect.bottom });
      }}
    >
      <span className="truncate">{native.serverName}</span>
      <ChevronsUpDownIcon data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}
