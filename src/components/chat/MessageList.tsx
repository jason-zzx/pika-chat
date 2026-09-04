"use client";

import { useState } from "react";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageItem from "./MessageItem";

type MessageListProps = {
  messages: ChatUIMessage[];
  streaming: boolean;
  /** Id of the message currently streaming outside the last-message default
   * (e.g. an in-place regeneration). */
  streamingMessageId?: string;
  assistantName?: string;
  assistantIcon?: string;
  onRegenerate?: (message: ChatUIMessage) => void;
  onDelete?: (message: ChatUIMessage) => void;
  onDeleteRegenerate?: (message: ChatUIMessage) => void;
  onSelectVersion?: (message: ChatUIMessage, versionId: string) => void;
};

export default function MessageList({
  messages,
  streaming,
  streamingMessageId,
  assistantName,
  assistantIcon,
  onRegenerate,
  onDelete,
  onDeleteRegenerate,
  onSelectVersion,
}: MessageListProps) {
  // Single-active tap reveal (R9/B7): at most one message shows its meta /
  // actions / version switcher rows from tapping. Tapping a message reveals
  // it and it stays revealed until a different message is tapped; tapping the
  // same message again does NOT hide it. Keyed by version group (same rule
  // as the element key below) so the reveal survives a version switch,
  // delete, or regenerate of the revealed message (B1).
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Send a message to start this conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto flex w-full max-w-[52.5rem] flex-col gap-4">
        <div className="sr-only" aria-live="polite">
          {streaming ? "Assistant is responding" : ""}
        </div>
        {messages.map((message, index) => {
          // Key by version group, not the per-version message id: switching
          // versions, deleting a version, or regenerating swaps in a
          // different-id row, and keying by id would remount the item (B1).
          // User messages carry no groupId metadata and never change id, so
          // they fall back to id.
          const itemKey = message.metadata?.groupId ?? message.id;
          return (
            <MessageItem
              key={itemKey}
              message={message}
              streaming={
                streaming &&
                (streamingMessageId !== undefined
                  ? message.id === streamingMessageId
                  : index === messages.length - 1 &&
                    message.role === "assistant")
              }
              revealed={revealedKey === itemKey}
              onReveal={() => setRevealedKey(itemKey)}
              assistantName={assistantName}
              assistantIcon={assistantIcon}
              onRegenerate={onRegenerate}
              onDelete={onDelete}
              onDeleteRegenerate={onDeleteRegenerate}
              onSelectVersion={onSelectVersion}
            />
          );
        })}
      </div>
    </div>
  );
}
