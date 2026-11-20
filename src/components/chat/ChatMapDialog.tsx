"use client";

import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatUIMessage } from "@/lib/schemas/chat";
import { cn } from "@/lib/utils";

type ChatMapDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: ChatUIMessage[];
  onSelect: (key: string) => void;
};

/** Collapses runs of whitespace so a multi-line message previews on one row.
 * Attachment-only messages preview by filename rather than "No text". */
function previewText(message: ChatUIMessage): string {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 0) {
    return text;
  }
  return message.parts
    .filter((part) => part.type === "file")
    .map((part) => part.filename ?? "")
    .filter((name) => name.length > 0)
    .join(" ");
}

/**
 * Overview of the whole conversation: one truncated row per currently
 * rendered message, in conversation order. Selecting a row hands the
 * version-group key back so the list can scroll to it.
 */
export default function ChatMapDialog({
  open,
  onOpenChange,
  messages,
  onSelect,
}: ChatMapDialogProps) {
  const t = useTranslations("Chat.Dialogs");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("chatMap")}</DialogTitle>
        </DialogHeader>
        <ul className="thin-scrollbar -mx-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 py-0.5">
          {messages.map((message) => {
            // Same granularity as the message list's React key: a version
            // group is one row, holding whichever version is displayed.
            const key = message.metadata?.groupId ?? message.id;
            const preview = previewText(message);
            const isUser = message.role === "user";
            const empty = preview.length === 0;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  className={cn(
                    "group/map-row flex w-full focus-visible:outline-none",
                    isUser ? "justify-end" : "justify-start",
                  )}
                >
                  <span
                    className={cn(
                      // Filled vs outlined on top of the alignment split:
                      // three signals, so the two sides stay tellable apart
                      // at a glance.
                      "block max-w-[85%] truncate rounded-xl px-3.5 py-2 text-base shadow-2xs transition-[background-color,border-color,color,transform] duration-150 group-focus-visible/map-row:ring-3 group-focus-visible/map-row:ring-ring/50 group-active/map-row:scale-[0.99] md:px-3 md:py-1.5 md:text-sm",
                      isUser
                        ? "bg-muted font-medium text-foreground group-hover/map-row:bg-accent"
                        : "border border-border bg-card font-normal text-card-foreground group-hover/map-row:border-ring/40 group-hover/map-row:bg-accent/60",
                      empty && "text-muted-foreground italic",
                    )}
                  >
                    {empty ? t("noText") : preview}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
