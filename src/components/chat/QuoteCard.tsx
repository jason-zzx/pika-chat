"use client";

import { TextQuoteIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type QuoteCardProps = {
  text: string;
  /** Jump to the quoted source text. */
  onJump: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
};

/** Atomic quote card shown above the composer, the editor, and sent user
 * bubbles: icon + two-line excerpt, optionally jumpable and removable. */
export default function QuoteCard({
  text,
  onJump,
  onRemove,
  disabled = false,
  className,
}: QuoteCardProps) {
  const t = useTranslations("Chat.Quote");
  return (
    <div
      className={cn(
        "flex max-w-full items-start gap-1 rounded-lg border border-border bg-background/60 text-sm text-muted-foreground md:text-xs",
        className,
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:px-2"
        aria-label={t("jump", { text })}
        onClick={onJump}
      >
        <TextQuoteIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 break-words text-left">{text}</span>
      </button>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="m-1 shrink-0"
          aria-label={t("remove")}
          title={t("remove")}
          disabled={disabled}
          onClick={onRemove}
        >
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
