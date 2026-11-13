"use client";

import { useTranslations } from "next-intl";

import { useDemoUsage } from "@/hooks/use-demo-usage";
import { useIsGuest } from "@/hooks/use-is-guest";

const LABEL_KEYS = {
  model: "demo.usageModels",
  search: "demo.usageSearch",
  upload: "demo.usageUploads",
} as const;
const KINDS = ["model", "search", "upload"] as const;

export default function DemoUsageCard() {
  const t = useTranslations("Auth");
  // Disabled for non-guests, so the query never has data and the card stays empty.
  const usage = useDemoUsage(useIsGuest());

  if (!usage.data) {
    return null;
  }

  return (
    <div className="mx-2 mb-1 rounded-lg border bg-background/60 px-2.5 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      <p className="mb-1 font-medium text-foreground">{t("demo.usageTitle")}</p>
      <ul className="flex flex-col gap-0.5 tabular-nums">
        {KINDS.map((kind) => (
          <li key={kind}>
            {t(LABEL_KEYS[kind], {
              // An operator can lower a limit mid-day below a stored count.
              remaining: Math.max(0, usage.data[kind].limit - usage.data[kind].used),
              limit: usage.data[kind].limit,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
