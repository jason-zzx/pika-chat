"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { CheckIcon, CopyIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type ExternalLinkDialogProps = {
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** How long the copy button shows "Copied" before reverting. */
const COPIED_FEEDBACK_MS = 2000;

/**
 * Confirmation before navigating to an external URL. Visually mirrors
 * Streamdown's built-in linkSafety modal (used for message-body links):
 * same structure, classes, and copy, layered on the AlertDialog primitive
 * for focus trapping and Escape handling. Copy goes through
 * `copyTextToClipboard` so it works on plain-HTTP LAN origins where the
 * Clipboard API is absent.
 */
export default function ExternalLinkDialog({
  url,
  open,
  onOpenChange,
}: ExternalLinkDialogProps) {
  const t = useTranslations("Chat.Dialogs");
  const tCommon = useTranslations("Common");
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(copiedTimeoutRef.current);
  }, []);

  // Reset the copy feedback once the dialog closes (render-time state
  // adjustment instead of an effect, per react-hooks/set-state-in-effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setCopied(false);
    }
  }

  async function onCopy() {
    const ok = await copyTextToClipboard(url);
    // On failure just don't switch to the "Copied" feedback.
    if (!ok) {
      return;
    }
    setCopied(true);
    window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(
      () => setCopied(false),
      COPIED_FEEDBACK_MS,
    );
  }

  function onConfirm() {
    window.open(url, "_blank", "noreferrer");
    onOpenChange(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        overlayClassName="bg-background/50 supports-backdrop-filter:backdrop-blur-sm"
        onOverlayClick={() => onOpenChange(false)}
        className="flex w-[calc(100%-2rem)] flex-col gap-4 rounded-xl border bg-background p-6 shadow-lg ring-0 data-[size=default]:max-w-md data-[size=default]:sm:max-w-md"
      >
        <AlertDialogPrimitive.Close
          className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={tCommon("close")}
          title={tCommon("close")}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </AlertDialogPrimitive.Close>
        <AlertDialogTitle className="flex items-center gap-2 font-semibold text-lg">
          <ExternalLinkIcon aria-hidden="true" className="size-5" />
          {t("externalLinkTitle")}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-muted-foreground text-sm">
          {t("externalLinkDescription")}
        </AlertDialogDescription>
        <div
          className={cn(
            "break-all rounded-md bg-muted p-3 font-mono text-sm",
            url.length > 100 && "max-h-32 overflow-y-auto",
          )}
        >
          {url}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 font-medium text-sm transition-all hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {copied ? (
              <CheckIcon aria-hidden="true" className="size-3.5" />
            ) : (
              <CopyIcon aria-hidden="true" className="size-3.5" />
            )}
            {copied ? t("copied") : t("copyLink")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            {t("openLink")}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
