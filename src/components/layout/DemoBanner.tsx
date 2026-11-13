"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export default function DemoBanner() {
  const t = useTranslations("Auth");

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground"
    >
      <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{t("demo.banner")}</span>
    </div>
  );
}
