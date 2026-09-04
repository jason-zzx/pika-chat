"use client";

import { useEffect, useState } from "react";

import { formatMessageAge, formatMessageExact } from "@/lib/message-time";

const REFRESH_INTERVAL_MS = 30_000;

type MessageTimestampProps = {
  createdAt: string | undefined;
};

export default function MessageTimestamp({ createdAt }: MessageTimestampProps) {
  const [now, setNow] = useState(() => Date.now());

  // Keep relative labels fresh; a single cheap interval per mounted timestamp.
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const label = formatMessageAge(createdAt, now);
  const exact = formatMessageExact(createdAt);
  if (!label || !exact) {
    return null;
  }

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
