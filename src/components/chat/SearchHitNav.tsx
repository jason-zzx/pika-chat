"use client";

import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

type SearchHitNavProps = {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

/** Floating "k / n" navigator over the message hits of the search jump that
 * brought the user here. Persistent (never hover-gated); sits above the
 * scroll-to-bottom button, which is centered at bottom-4. */
export default function SearchHitNav({
  index,
  total,
  onPrev,
  onNext,
  onClose,
}: SearchHitNavProps) {
  const t = useTranslations("Search.palette");
  return (
    <div className="absolute bottom-20 right-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-popover px-2 py-1 text-sm text-popover-foreground shadow-md">
      <span className="px-1 tabular-nums">
        {index + 1} / {total}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("prevHit")}
        disabled={index <= 0}
        onClick={onPrev}
      >
        <ChevronUpIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("nextHit")}
        disabled={index >= total - 1}
        onClick={onNext}
      >
        <ChevronDownIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("closeNav")}
        onClick={onClose}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
