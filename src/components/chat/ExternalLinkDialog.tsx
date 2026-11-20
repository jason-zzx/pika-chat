"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { CheckIcon, CopyIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
 * Confirmation before navigating to an external URL, used for citation
 * chips, fetch tool links, and (via Streamdown's `linkSafety.renderModal`)
 * message-body links. Styled after Streamdown's built-in linkSafety modal,
 * layered on the AlertDialog primitive for focus trapping, Escape handling,
 * and open/close animation. Copy goes through
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
        onOverlayClick={() => onOpenChange(false)}
        className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md"
      >
        <AlertDialogPrimitive.Close
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
            />
          }
          aria-label={tCommon("close")}
          title={tCommon("close")}
        >
          <XIcon aria-hidden="true" />
        </AlertDialogPrimitive.Close>
        <AlertDialogHeader className="place-items-start pr-8 text-left">
          <AlertDialogTitle className="flex items-center gap-2">
            <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0" />
            {t("externalLinkTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("externalLinkDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div
          className={cn(
            "rounded-lg bg-muted p-3 font-mono text-xs break-all text-foreground",
            url.length > 100 && "max-h-32 overflow-y-auto",
          )}
        >
          {url}
        </div>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onCopy}>
            {copied ? (
              <>
                <CheckIcon aria-hidden="true" />
                {t("copied")}
              </>
            ) : (
              <>
                <CopyIcon aria-hidden="true" />
                {t("copyLink")}
              </>
            )}
          </Button>
          <Button type="button" onClick={onConfirm}>
            <ExternalLinkIcon aria-hidden="true" />
            {t("openLink")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
