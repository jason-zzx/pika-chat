"use client";

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

/** Collapses runs of whitespace so a multi-line message previews on one row. */
function previewText(message: ChatUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chat map</DialogTitle>
        </DialogHeader>
        <ul className="thin-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
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
                    "flex w-full py-0.5",
                    isUser ? "justify-end" : "justify-start",
                  )}
                >
                  <span
                    className={cn(
                      // Filled vs outlined on top of the alignment split:
                      // three signals, so the two sides stay tellable apart
                      // at a glance.
                      "block max-w-[85%] truncate rounded-lg px-3 py-2 text-sm",
                      isUser
                        ? "bg-muted font-medium"
                        : "border border-border font-normal",
                      empty && "text-muted-foreground",
                    )}
                  >
                    {empty ? "No text" : preview}
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
