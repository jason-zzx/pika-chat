"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";

import { getMessageAge, parseTimestamp } from "@/lib/message-time";
import { localTimeZone } from "@/lib/time-zone";

const REFRESH_INTERVAL_MS = 30_000;

type MessageTimestampProps = {
  createdAt: string | undefined;
};

export default function MessageTimestamp({ createdAt }: MessageTimestampProps) {
  const t = useTranslations("Chat.Timestamp");
  const format = useFormatter();
  // Keep relative labels fresh; a single cheap interval per mounted timestamp.
  const now = useNow({ updateInterval: REFRESH_INTERVAL_MS });

  const date = parseTimestamp(createdAt);
  const age = getMessageAge(createdAt, now.getTime());
  if (!date || !age) {
    return null;
  }

  // Browser-local zone: no global `timeZone` is configured (it would change
  // user-visible times); passing it explicitly avoids next-intl's warning.
  const timeZone = localTimeZone();
  const label =
    age.kind === "justNow"
      ? t("justNow")
      : age.kind === "minutes"
        ? t("minutes", { count: age.count })
        : age.kind === "hours"
          ? t("hours", { count: age.count })
          : format.dateTime(age.date, {
              month: "short",
              day: "numeric",
              ...(age.withYear ? { year: "numeric" as const } : {}),
              timeZone,
            });
  const exact = format.dateTime(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  });

  return (
    <time
      dateTime={createdAt}
      title={exact}
      className="flex h-5 shrink-0 items-center text-xs text-muted-foreground opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/message:opacity-100 group-focus-within/message:opacity-100 group-data-[revealed=true]/message:opacity-100"
    >
      {label}
    </time>
  );
}
