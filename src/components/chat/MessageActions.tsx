"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef, useState } from "react";

const COPY_RESET_MS = 2_000;

type CopyState = "idle" | "success" | "failed";

const COPY_STATE_TITLE: Record<CopyState, string> = {
  idle: "Copy message",
  success: "Copied",
  failed: "Copy failed",
};

type MessageActionsProps = {
  text: string;
};

export default function MessageActions({ text }: MessageActionsProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimeoutRef = useRef<number | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("success");
    } catch {
      setCopyState("failed");
    }
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = window.setTimeout(() => {
      resetTimeoutRef.current = null;
      setCopyState("idle");
    }, COPY_RESET_MS);
  }

  return (
    <div className="flex h-5 shrink-0 items-center opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/message:opacity-100 group-focus-within/message:opacity-100">
      <button
        type="button"
        aria-label="Copy message"
        title={COPY_STATE_TITLE[copyState]}
        onClick={() => {
          void handleCopy();
        }}
        className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {copyState === "success" ? (
          <CheckIcon aria-hidden="true" className="size-3.5" />
        ) : (
          <CopyIcon aria-hidden="true" className="size-3.5" />
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {copyState === "success" ? "Copied" : copyState === "failed" ? "Copy failed" : ""}
      </span>
    </div>
  );
}
