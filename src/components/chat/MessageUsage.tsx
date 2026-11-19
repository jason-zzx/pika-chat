"use client";

import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatUsage } from "@/lib/schemas/chat";

type MessageUsageProps = {
  usage: ChatUsage;
};

export default function MessageUsage({ usage }: MessageUsageProps) {
  const t = useTranslations("Chat.MessageItem.usage");
  const locale = useLocale();

  if (usage.outputTokens === undefined) {
    return null;
  }

  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const grouped = new Intl.NumberFormat(locale);
  const tpsFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const missing = t("missing");
  const tps = usage.outputMs
    ? (usage.outputTokens / usage.outputMs) * 1000
    : undefined;
  const hitRate =
    usage.cacheReadTokens !== undefined && usage.inputTokens
      ? Math.round((usage.cacheReadTokens / usage.inputTokens) * 100)
      : undefined;

  const compactIn =
    usage.inputTokens !== undefined
      ? compact.format(usage.inputTokens)
      : missing;
  const compactOut = compact.format(usage.outputTokens);
  const tokens = `↑${compactIn} ↓${compactOut}`;
  const tpsLabel =
    tps !== undefined ? t("tps", { tps: tpsFormat.format(tps) }) : null;
  const fullSummary = tpsLabel ? `${tokens} · ${tpsLabel}` : tokens;

  const seconds = (ms?: number) =>
    ms === undefined
      ? missing
      : t("seconds", { seconds: (ms / 1000).toFixed(1) });

  const rows: (readonly [string, string])[] = [
    [
      t("inputTokens"),
      usage.inputTokens !== undefined
        ? grouped.format(usage.inputTokens)
        : missing,
    ],
    [t("outputTokens"), grouped.format(usage.outputTokens)],
    ...(usage.cacheReadTokens !== undefined
      ? [[t("cacheReadTokens"), grouped.format(usage.cacheReadTokens)] as const]
      : []),
    ...(hitRate !== undefined
      ? [[t("cacheHitRate"), t("percent", { percent: hitRate })] as const]
      : []),
    ...(tpsLabel ? [[t("outputSpeed"), tpsLabel] as const] : []),
    [t("ttft"), seconds(usage.ttftMs)],
    [t("totalDuration"), seconds(usage.durationMs)],
  ];

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={100}
        aria-label={t("triggerLabel", { summary: fullSummary })}
        className="ml-auto inline-flex shrink-0 items-center rounded-sm px-1 py-0.5 text-[13px] tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-xs"
      >
        <span className={tpsLabel ? "hidden md:inline" : undefined}>
          {tokens}
          {tpsLabel ? " · " : null}
        </span>
        {tpsLabel}
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-60 gap-2 p-3 text-sm md:text-xs">
        <p className="font-medium text-foreground">{t("title")}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 tabular-nums">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium text-foreground">
                {value}
              </dd>
            </Fragment>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
